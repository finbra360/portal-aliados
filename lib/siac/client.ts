import { decodeEntities, parseAsmxJson } from "./parse";
import type { ConsultarPagosResponse, ConsultarSaldoCreditoResponse, ListadoCobranzaResponse, SiacEnvelope } from "./types";

export type SiacAmbiente = "pruebas" | "produccion";

export interface SiacConfig {
  baseUrl: string;
  razonSocial: string;
  claveAutenticacion: string;
  ambiente: SiacAmbiente;
}

/** Registro de cada llamada, para guardarlo en col_siac_raw. Nunca trae credenciales. */
export interface SiacCallRecord {
  operacion: string;
  parametros: Record<string, string>;
  httpStatus: number | null;
  detalle: string | null;
  respuesta: unknown;
}

/**
 * - reintentable=false: SIAC contestó y el problema no se arregla solo
 *   (parámetro faltante, filtro mal formado, error de negocio en Detalle).
 * - reintentable=true: red, tiempo de espera o un 5xx sin explicación.
 */
export class SiacError extends Error {
  readonly operacion: string;
  readonly detalle: string | null;
  readonly reintentable: boolean;

  constructor(message: string, operacion: string, detalle: string | null, reintentable: boolean) {
    super(message);
    this.name = "SiacError";
    this.operacion = operacion;
    this.detalle = detalle;
    this.reintentable = reintentable;
  }
}

const TIMEOUT_MS = 60_000;
const REINTENTOS = 2;
/** Listado Personalizado: registros por página (más que toda la cartera) y tope de páginas por foto. */
const REGISTROS_POR_PAGINA = 1000;
const MAX_PAGINAS_LISTADO = 5;

// ListadoCobranzaJSON escribe el parámetro "Autentificacion" (con "fi");
// el resto de los servicios usan "ClaveAutenticacion".
const NOMBRE_CLAVE: Record<string, string> = {
  ListadoCobranzaJSON: "ClaveAutentificacion",
};

export function getSiacConfig(): SiacConfig | null {
  const baseUrl = process.env.SIAC_BASE_URL;
  const razonSocial = process.env.SIAC_RAZON_SOCIAL;
  const claveAutenticacion = process.env.SIAC_CLAVE_AUTENTICACION;
  const ambiente = process.env.SIAC_AMBIENTE;
  if (!baseUrl || !razonSocial || !claveAutenticacion) return null;
  if (ambiente !== "pruebas" && ambiente !== "produccion") return null;
  return { baseUrl: baseUrl.replace(/\/$/, ""), razonSocial, claveAutenticacion, ambiente };
}

/** Clasifica una respuesta que no es el sobre JSON de SIAC. */
function errorDeRespuesta(operacion: string, status: number, texto: string): SiacError {
  const limpio = decodeEntities(texto).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  const falta = limpio.match(/Falta el par[aá]metro:\s*([\w]+)/i);
  if (falta) {
    return new SiacError(`SIAC ${operacion}: falta el parámetro ${falta[1]}`, operacion, `Falta el parámetro: ${falta[1]}`, false);
  }
  if (/FormatoIncorrectoJson/i.test(limpio)) {
    return new SiacError(`SIAC ${operacion}: filtro con formato incorrecto`, operacion, limpio.slice(0, 300), false);
  }
  return new SiacError(`SIAC ${operacion} respondió ${status}: ${limpio.slice(0, 200)}`, operacion, null, status >= 500);
}

/**
 * Cliente de solo lectura para ConsultasSIACSuiteJSON.asmx.
 *
 * SIAC pidió no hacer cargas masivas con servicios individuales: la foto
 * diaria usa UNA llamada a ListadoCobranzaJSON, y consultarSaldoCredito es
 * solo para consultas puntuales que pide una persona.
 */
export class SiacClient {
  llamadas = 0;
  duracionMs = 0;
  private readonly config: SiacConfig;
  private readonly onCall?: (record: SiacCallRecord) => void | Promise<void>;

  constructor(config: SiacConfig, onCall?: (record: SiacCallRecord) => void | Promise<void>) {
    this.config = config;
    this.onCall = onCall;
  }

  private async call<T extends SiacEnvelope>(operacion: string, parametros: Record<string, string>): Promise<T> {
    const body = new URLSearchParams({
      RazonSocial: this.config.razonSocial,
      [NOMBRE_CLAVE[operacion] ?? "ClaveAutenticacion"]: this.config.claveAutenticacion,
      ...parametros,
    });

    let ultimoError: unknown = null;
    for (let intento = 0; intento <= REINTENTOS; intento++) {
      if (intento > 0) await new Promise((r) => setTimeout(r, 2000 * 3 ** (intento - 1)));
      this.llamadas++;
      const inicio = Date.now();
      let httpStatus: number | null = null;
      let texto = "";
      try {
        const res = await fetch(`${this.config.baseUrl}/${operacion}`, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body,
          cache: "no-store",
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        httpStatus = res.status;
        texto = await res.text();
        this.duracionMs += Date.now() - inicio;

        if (!/<string[^>]*>/.test(texto)) throw errorDeRespuesta(operacion, res.status, texto);
        const data = parseAsmxJson<T>(texto);
        await this.onCall?.({ operacion, parametros, httpStatus, detalle: data.Detalle ?? null, respuesta: data });
        if (data.Detalle !== "CORRECTO") {
          const detalle = String(data.Detalle ?? "sin detalle");
          const formato = /FormatoIncorrectoJson/i.test(detalle);
          throw new SiacError(
            `SIAC ${operacion}: ${formato ? "filtro con formato incorrecto" : detalle}`,
            operacion,
            detalle,
            false,
          );
        }
        return data;
      } catch (e) {
        if (httpStatus === null) this.duracionMs += Date.now() - inicio;
        const registrado = e instanceof SiacError && httpStatus !== null && /<string[^>]*>/.test(texto);
        if (!registrado) {
          await this.onCall?.({
            operacion,
            parametros,
            httpStatus,
            detalle: e instanceof SiacError ? e.detalle : null,
            respuesta: texto ? decodeEntities(texto).slice(0, 2000) : String(e),
          });
        }
        if (e instanceof SiacError && !e.reintentable) throw e;
        ultimoError = e;
      }
    }
    throw ultimoError instanceof Error
      ? ultimoError
      : new SiacError(`SIAC ${operacion} falló`, operacion, null, true);
  }

  /**
   * Foto de cobranza de toda la cartera activa a `corteFecha` (NoControl vacío),
   * o de un solo crédito (NoControl con valor). Lee la foto que el Monitor de
   * Servicios de SIAC guarda a las 00:00; no calcula al momento.
   */
  listadoCobranza(corteFecha: string, noControl = "") {
    const contenido = {
      ListadoFiltroCobranza: [
        { CorteFecha: corteFecha, NoControl: noControl, Cliente: "", TipoCredito: "", Cobrador: "", Sucursal: "", Estado: "", Municipio: "" },
      ],
    };
    return this.call<ListadoCobranzaResponse>("ListadoCobranzaJSON", { Contenido: JSON.stringify(contenido) });
  }

  /**
   * Listado Cobranza Personalizado: lo mismo que listadoCobranza (mismo filtro y
   * los mismos campos) más MontoSiguienteVencimiento, TotalGlobal y el plazo.
   * Viene paginado (RegistrosPorPagina / NoPagina).
   */
  listadoCobranzaPersonalizado(p: { corteFecha: string; pagina: number; porPagina: number }) {
    const contenido = {
      ListadoFiltroCobranza: [
        { CorteFecha: p.corteFecha, NoControl: "", Cliente: "", TipoCredito: "", Cobrador: "", Sucursal: "", Estado: "", Municipio: "" },
      ],
    };
    return this.call<ListadoCobranzaResponse & { PaginasTotales?: number | string }>("ListadoCobranzaPersonalizado", {
      Contenido: JSON.stringify(contenido),
      RegistrosPorPagina: String(p.porPagina),
      NoPagina: String(p.pagina),
    });
  }

  /**
   * La foto del día para la sincronización. Usa el Listado Personalizado (trae
   * MontoSiguienteVencimiento; mismos campos que el estándar, probado el
   * 2026-10-26 con los 50 créditos de pruebas) con 1,000 registros por página:
   * normalmente es una sola llamada. Si el Personalizado no está habilitado
   * (error que no se resuelve reintentando), cae a ListadoCobranzaJSON para no
   * dejar el día sin foto, y lo avisa.
   */
  async listadoDelDia(corteFecha: string): Promise<{ respuesta: ListadoCobranzaResponse; origen: "personalizado" | "estandar"; aviso: string | null }> {
    try {
      const paginas: ListadoCobranzaResponse[] = [];
      let total = 1;
      for (let pagina = 1; pagina <= total && pagina <= MAX_PAGINAS_LISTADO; pagina++) {
        const r = await this.listadoCobranzaPersonalizado({ corteFecha, pagina, porPagina: REGISTROS_POR_PAGINA });
        paginas.push(r);
        total = Number(r.PaginasTotales) || 1;
      }
      const cobranza = paginas.flatMap((p) => p.vListEntCredito?.flatMap((v) => v.Cobranza ?? []) ?? []);
      const aviso = total > MAX_PAGINAS_LISTADO ? `El Listado Personalizado trae ${total} páginas; solo se leyeron ${MAX_PAGINAS_LISTADO}` : null;
      return { respuesta: { Detalle: "CORRECTO", vListEntCredito: [{ Cobranza: cobranza }] }, origen: "personalizado", aviso };
    } catch (e) {
      if (!(e instanceof SiacError) || e.reintentable) throw e;
      const respuesta = await this.listadoCobranza(corteFecha);
      return { respuesta, origen: "estandar", aviso: `No se pudo usar el Listado Personalizado (${e.message}); la foto salió del listado estándar, sin el monto de la siguiente cuota` };
    }
  }

  /**
   * Historia de pagos de UN crédito. Es un servicio individual: nunca en lote
   * para toda la cartera (ver lib/collections/payments.ts).
   */
  consultarPagos(idCliente: string, noControl: string) {
    return this.call<ConsultarPagosResponse>("ConsultarPagos", { IDCliente: idCliente, NoControl: noControl });
  }

  /** Saldo calculado al vuelo de UN crédito. Solo bajo demanda, nunca en lote. */
  consultarSaldoCredito(noControl: string, idCliente: string, fechaCorte: string) {
    return this.call<ConsultarSaldoCreditoResponse>("ConsultarSaldoCredito", {
      NoControl: noControl,
      IDCliente: idCliente,
      FechaCorte: fechaCorte,
    });
  }
}
