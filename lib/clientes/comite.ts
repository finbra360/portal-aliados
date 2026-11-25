// Análisis, oferta, expediente y comité de un negocio de crédito (fase O5).
// Quién captura qué: el análisis, quien tiene «originacion.analizar»; la
// decisión de comité, quien tiene «originacion.decidir»; la oferta y los
// documentos, quien opera originación (lib/permisos.ts). Lo que pide cada
// etapa para avanzar está en faltantesPara (lib/clientes/negocios.ts).
// Funciones puras, sin base de datos, para probarlas con `node --test`.

import { leerMonto, MONTO_MAXIMO, PRODUCTOS, type Producto, type Validado } from "./negocios.ts";

const limpio = (v: unknown) => (typeof v === "string" ? v.trim() : "");

// ---------------------------------------------------------------- análisis

export type ResultadoBuro = "limpio" | "observaciones" | "malo";
export const RESULTADOS_BURO: Record<ResultadoBuro, string> = {
  limpio: "Limpio",
  observaciones: "Con observaciones",
  malo: "Malo",
};

export interface DatosAnalisis {
  buroResultado: ResultadoBuro | null;
  /** Pago mensual que la empresa puede cubrir, según el análisis. */
  capacidadPagoMensual: number | null;
  notas: string | null;
}

/** Todos opcionales al guardar; para pasar a Oferta se piden buró y capacidad de pago. */
export function validarAnalisis(entrada: Record<string, unknown>): Validado<DatosAnalisis> {
  const buro = limpio(entrada.buroResultado);
  if (buro && !(buro in RESULTADOS_BURO)) return { ok: false, error: "El resultado de buró no es válido." };
  const capacidad = leerMonto(entrada.capacidadPagoMensual);
  if (capacidad === "invalido") return { ok: false, error: "La capacidad de pago no es válida. Escríbela sin letras, por ejemplo 85,000." };
  if (capacidad !== null && capacidad > MONTO_MAXIMO) return { ok: false, error: "La capacidad de pago es demasiado alta. Revisa que no sobre un cero." };
  const notas = limpio(entrada.notas) || null;
  if ((notas?.length ?? 0) > 4000) return { ok: false, error: "Las notas del análisis son demasiado largas (máximo 4,000 caracteres)." };
  return { ok: true, datos: { buroResultado: (buro || null) as ResultadoBuro | null, capacidadPagoMensual: capacidad, notas } };
}

// ---------------------------------------------------------------- oferta

export type RespuestaOferta = "aceptada" | "no_aceptada";
export const RESPUESTAS_OFERTA: Record<RespuestaOferta, string> = { aceptada: "La aceptó", no_aceptada: "No la aceptó" };

export interface DatosOferta {
  monto: number | null;
  tasaAnual: number | null;
  plazoMeses: number | null;
  comisionAperturaPct: number | null;
  respuesta: RespuestaOferta | null;
}

/** Porcentaje de 0 a `max` con hasta dos decimales; acepta «%». Vacío = null. */
function leerPct(v: unknown, max: number): number | null | "invalido" {
  const t = limpio(v).replace("%", "").trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 && n <= max && Math.round(n * 100) === n * 100 ? n : "invalido";
}

function leerPlazo(v: unknown): number | null | "invalido" {
  const t = limpio(v);
  if (!t) return null;
  const n = Number(t);
  return Number.isInteger(n) && n >= 1 && n <= 120 ? n : "invalido";
}

/** Todos opcionales al guardar; para pasar a Expediente se pide la oferta completa y aceptada. */
export function validarOferta(entrada: Record<string, unknown>): Validado<DatosOferta> {
  const monto = leerMonto(entrada.monto);
  if (monto === "invalido") return { ok: false, error: "El monto ofrecido no es válido. Escríbelo sin letras, por ejemplo 1,500,000." };
  if (monto !== null && monto > MONTO_MAXIMO) return { ok: false, error: `El monto pasa de ${MONTO_MAXIMO.toLocaleString("es-MX")}. Revisa que no sobre un cero.` };
  const tasa = leerPct(entrada.tasaAnual, 100);
  if (tasa === "invalido" || tasa === 0) return { ok: false, error: "La tasa anual va de 0.01 a 100 %, con hasta dos decimales." };
  const plazo = leerPlazo(entrada.plazoMeses);
  if (plazo === "invalido") return { ok: false, error: "El plazo va de 1 a 120 meses." };
  const comision = leerPct(entrada.comisionAperturaPct, 20);
  if (comision === "invalido") return { ok: false, error: "La comisión por apertura va de 0 a 20 %, con hasta dos decimales." };
  const respuesta = limpio(entrada.respuesta);
  if (respuesta && !(respuesta in RESPUESTAS_OFERTA)) return { ok: false, error: "La respuesta del cliente no es válida." };
  return { ok: true, datos: { monto, tasaAnual: tasa, plazoMeses: plazo, comisionAperturaPct: comision, respuesta: (respuesta || null) as RespuestaOferta | null } };
}

// ---------------------------------------------------------------- expediente

export type EstadoDocumento = "pendiente" | "recibido" | "no_aplica";
export const ESTADOS_DOCUMENTO: Record<EstadoDocumento, string> = { pendiente: "Pendiente", recibido: "Recibido", no_aplica: "No aplica" };

/** Documentos que se piden por producto. Se cambian en Clientes → Ajustes (crm_settings «expediente»). */
export type ListasDocumentos = Record<Producto, string[]>;

const COMUNES = [
  "Solicitud de crédito firmada",
  "Autorización de consulta a buró (empresa y aval)",
  "Acta constitutiva y poderes del representante legal",
  "Identificación del representante legal y del aval",
  "Comprobante de domicilio",
  "Constancia de situación fiscal",
  "Estados de cuenta bancarios de los últimos 6 meses",
  "Estados financieros (último cierre y parciales) y declaración anual",
  "Documentos de la garantía (factura, tarjeta de circulación o escrituras)",
];

export const DOCUMENTOS_DEFAULT: ListasDocumentos = {
  pyme: COMUNES,
  simple: COMUNES,
  arrendamiento: [...COMUNES, "Cotización o factura proforma del activo"],
};

export const MAX_DOCUMENTOS = 40;

/** Clave estable de un documento a partir de su nombre: «Acta constitutiva…» → «acta-constitutiva…». */
export function claveDocumento(nombre: string): string {
  return nombre
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

/** Una lista escrita en un cuadro de texto, un documento por renglón. */
export function leerListaDocumentos(texto: unknown, producto: string): Validado<string[]> {
  const nombres = limpio(texto)
    .split(/\r?\n/)
    .map((l) => l.replace(/^[-•*\d.)\s]+/, "").trim())
    .filter(Boolean);
  if (nombres.length === 0) return { ok: false, error: `${producto}: escribe al menos un documento.` };
  if (nombres.length > MAX_DOCUMENTOS) return { ok: false, error: `${producto}: son demasiados documentos (máximo ${MAX_DOCUMENTOS}).` };
  const vistos = new Set<string>();
  for (const n of nombres) {
    if (n.length > 150) return { ok: false, error: `${producto}: «${n.slice(0, 40)}…» es demasiado largo (máximo 150 caracteres).` };
    const clave = claveDocumento(n);
    if (!clave) return { ok: false, error: `${producto}: «${n}» necesita letras o números.` };
    if (vistos.has(clave)) return { ok: false, error: `${producto}: «${n}» está repetido.` };
    vistos.add(clave);
  }
  return { ok: true, datos: nombres };
}

/** Las tres listas desde el formulario de Ajustes (campos docs_pyme, docs_simple, docs_arrendamiento). */
export function validarListasDocumentos(entrada: Record<string, unknown>): Validado<ListasDocumentos> {
  const listas = {} as ListasDocumentos;
  for (const [p, nombre] of Object.entries(PRODUCTOS) as [Producto, string][]) {
    const r = leerListaDocumentos(entrada[`docs_${p}`], nombre);
    if (!r.ok) return r;
    listas[p] = r.datos;
  }
  return { ok: true, datos: listas };
}

/** Lo guardado en crm_settings, con lo que falte o venga mal reemplazado por la lista de siempre. */
export function listasDesdeAjuste(valor: unknown): ListasDocumentos {
  const v = (valor && typeof valor === "object" ? valor : {}) as Record<string, unknown>;
  const listas = {} as ListasDocumentos;
  for (const p of Object.keys(PRODUCTOS) as Producto[]) {
    const l = v[p];
    listas[p] = Array.isArray(l) && l.length > 0 && l.every((x) => typeof x === "string" && x.trim()) ? (l as string[]) : DOCUMENTOS_DEFAULT[p];
  }
  return listas;
}

export interface DocumentoExpediente {
  clave: string;
  nombre: string;
  estado: EstadoDocumento;
  actualizadoPor: string | null;
  actualizadoAt: string | null;
}

/**
 * La lista del producto con el estado de cada documento. Los marcados que ya
 * no están en la lista (se quitaron en Ajustes) no cuentan.
 */
export function documentosDelNegocio(
  lista: string[],
  marcados: { clave: string; estado: EstadoDocumento; actualizadoPor: string | null; actualizadoAt: string | null }[],
): DocumentoExpediente[] {
  const porClave = new Map(marcados.map((m) => [m.clave, m]));
  return lista.map((nombre) => {
    const clave = claveDocumento(nombre);
    const m = porClave.get(clave);
    return { clave, nombre, estado: m?.estado ?? "pendiente", actualizadoPor: m?.actualizadoPor ?? null, actualizadoAt: m?.actualizadoAt ?? null };
  });
}

export const documentosPendientes = (docs: DocumentoExpediente[]) => docs.filter((d) => d.estado === "pendiente").length;

/** Estados enviados por el formulario (campo doc_<clave>), solo de los documentos de la lista. */
export function validarDocumentos(lista: string[], entrada: Record<string, unknown>): Validado<{ clave: string; nombre: string; estado: EstadoDocumento }[]> {
  const r: { clave: string; nombre: string; estado: EstadoDocumento }[] = [];
  for (const nombre of lista) {
    const clave = claveDocumento(nombre);
    const estado = limpio(entrada[`doc_${clave}`]);
    if (!estado) continue;
    if (!(estado in ESTADOS_DOCUMENTO)) return { ok: false, error: `El estado de «${nombre}» no es válido.` };
    r.push({ clave, nombre, estado: estado as EstadoDocumento });
  }
  return { ok: true, datos: r };
}

/** Liga a la carpeta del expediente (Drive u otra), con https. Vacío = null. */
export function validarLigaExpediente(v: unknown): Validado<string | null> {
  const t = limpio(v);
  if (!t) return { ok: true, datos: null };
  if (t.length > 500) return { ok: false, error: "La liga es demasiado larga (máximo 500 caracteres)." };
  let u: URL;
  try {
    u = new URL(t);
  } catch {
    return { ok: false, error: "La liga no es válida. Cópiala completa, con https://." };
  }
  if (u.protocol !== "https:") return { ok: false, error: "La liga tiene que empezar con https://." };
  return { ok: true, datos: u.toString() };
}

// ---------------------------------------------------------------- comité

export type DecisionComite = "aprobado" | "rechazado";
export const DECISIONES: Record<DecisionComite, string> = { aprobado: "Aprobado", rechazado: "Rechazado" };

export interface DatosDecision {
  decision: DecisionComite;
  monto: number | null;
  tasaAnual: number | null;
  plazoMeses: number | null;
  /** Aprobado: condiciones (opcional). Rechazado: por qué (obligatorio). */
  condiciones: string | null;
}

/** Aprobado pide monto, tasa y plazo aprobados; rechazado pide el porqué. */
export function validarDecision(entrada: Record<string, unknown>): Validado<DatosDecision> {
  const decision = limpio(entrada.decision);
  if (!(decision in DECISIONES)) return { ok: false, error: "Elige si el comité aprobó o rechazó." };
  const condiciones = limpio(entrada.condiciones) || null;
  if ((condiciones?.length ?? 0) > 2000) return { ok: false, error: "El texto es demasiado largo (máximo 2,000 caracteres)." };
  if (decision === "rechazado") {
    if (!condiciones) return { ok: false, error: "Escribe por qué lo rechazó el comité." };
    return { ok: true, datos: { decision, monto: null, tasaAnual: null, plazoMeses: null, condiciones } };
  }
  const monto = leerMonto(entrada.monto);
  if (monto === null || monto === "invalido") return { ok: false, error: "Escribe el monto aprobado, por ejemplo 1,500,000." };
  if (monto > MONTO_MAXIMO) return { ok: false, error: `El monto pasa de ${MONTO_MAXIMO.toLocaleString("es-MX")}. Revisa que no sobre un cero.` };
  const tasa = leerPct(entrada.tasaAnual, 100);
  if (tasa === null || tasa === "invalido" || tasa === 0) return { ok: false, error: "Escribe la tasa anual aprobada (de 0.01 a 100 %)." };
  const plazo = leerPlazo(entrada.plazoMeses);
  if (plazo === null || plazo === "invalido") return { ok: false, error: "Escribe el plazo aprobado (de 1 a 120 meses)." };
  return { ok: true, datos: { decision: "aprobado", monto, tasaAnual: tasa, plazoMeses: plazo, condiciones } };
}
