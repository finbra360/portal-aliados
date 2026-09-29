import { parseAsmxJson } from "./parse";
import type {
  ConsultarClientesResponse,
  ConsultarCreditosResponse,
  ConsultarSaldoCreditoResponse,
  SiacEnvelope,
} from "./types";

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

export class SiacError extends Error {
  readonly operacion: string;
  readonly detalle: string | null;

  constructor(message: string, operacion: string, detalle: string | null) {
    super(message);
    this.name = "SiacError";
    this.operacion = operacion;
    this.detalle = detalle;
  }
}

const TIMEOUT_MS = 30_000;
const REINTENTOS = 2;

export function getSiacConfig(): SiacConfig | null {
  const baseUrl = process.env.SIAC_BASE_URL;
  const razonSocial = process.env.SIAC_RAZON_SOCIAL;
  const claveAutenticacion = process.env.SIAC_CLAVE_AUTENTICACION;
  const ambiente = process.env.SIAC_AMBIENTE;
  if (!baseUrl || !razonSocial || !claveAutenticacion) return null;
  if (ambiente !== "pruebas" && ambiente !== "produccion") return null;
  return { baseUrl: baseUrl.replace(/\/$/, ""), razonSocial, claveAutenticacion, ambiente };
}

/**
 * Cliente de solo lectura para ConsultasSIACSuiteJSON.asmx. Cada operación
 * se llama por POST form-urlencoded con RazonSocial y ClaveAutenticacion en
 * el body. Reintenta errores de red y 5xx; no reintenta cuando SIAC responde
 * con un Detalle distinto de "CORRECTO", porque eso no se arregla solo.
 */
export class SiacClient {
  llamadas = 0;
  private readonly config: SiacConfig;
  private readonly onCall?: (record: SiacCallRecord) => void | Promise<void>;

  constructor(config: SiacConfig, onCall?: (record: SiacCallRecord) => void | Promise<void>) {
    this.config = config;
    this.onCall = onCall;
  }

  private async call<T extends SiacEnvelope>(operacion: string, parametros: Record<string, string>): Promise<T> {
    const body = new URLSearchParams({
      RazonSocial: this.config.razonSocial,
      ClaveAutenticacion: this.config.claveAutenticacion,
      ...parametros,
    });

    let ultimoError: unknown = null;
    for (let intento = 0; intento <= REINTENTOS; intento++) {
      if (intento > 0) await new Promise((r) => setTimeout(r, 1000 * 3 ** (intento - 1)));
      this.llamadas++;
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
        if (res.status >= 500) {
          throw new SiacError(`SIAC ${operacion} respondió ${res.status}`, operacion, null);
        }
        const data = parseAsmxJson<T>(texto);
        await this.onCall?.({ operacion, parametros, httpStatus, detalle: data.Detalle ?? null, respuesta: data });
        if (data.Detalle !== "CORRECTO") {
          // Un Detalle de error es una respuesta válida de SIAC: no se reintenta.
          throw new SiacError(`SIAC ${operacion}: ${data.Detalle}`, operacion, data.Detalle ?? "sin detalle");
        }
        return data;
      } catch (e) {
        if (e instanceof SiacError && e.detalle !== null) throw e;
        ultimoError = e;
        await this.onCall?.({
          operacion,
          parametros,
          httpStatus,
          detalle: null,
          respuesta: texto ? texto.slice(0, 2000) : String(e),
        });
      }
    }
    throw ultimoError instanceof Error ? ultimoError : new SiacError(`SIAC ${operacion} falló`, operacion, null);
  }

  consultarClientes() {
    return this.call<ConsultarClientesResponse>("ConsultarClientes", { idCliente: "0", nombre: "", rfc: "" });
  }

  consultarCreditos(idCliente: string) {
    return this.call<ConsultarCreditosResponse>("ConsultarCreditos", { IDCliente: idCliente, NoControl: "" });
  }

  consultarSaldoCredito(noControl: string, idCliente: string, fechaCorte: string) {
    return this.call<ConsultarSaldoCreditoResponse>("ConsultarSaldoCredito", {
      NoControl: noControl,
      IDCliente: idCliente,
      FechaCorte: fechaCorte,
    });
  }
}
