// Negocios de crédito (originación): una solicitud de una empresa desde el
// primer contacto hasta el crédito dispersado en SIAC. Reemplaza al pipeline
// de negocios de HubSpot. Ver crm_negocios_credito en lib/db/crm-schema.sql.
// Funciones puras, sin base de datos, para probarlas con `node --test`.

import { validarRfc } from "./rfc.ts";

export type EtapaNegocio =
  | "prospecto"
  | "calificado"
  | "solicitud"
  | "analisis"
  | "oferta"
  | "expediente"
  | "comite"
  | "formalizacion"
  | "dispersado"
  | "pospuesto"
  | "rechazado";

/** Etapas en orden del proceso, con lo que pasa en cada una. Pospuesto y rechazado son cierres. */
export const ETAPAS_NEGOCIO: { value: EtapaNegocio; label: string; que: string }[] = [
  { value: "prospecto", label: "Prospecto", que: "Primer contacto, hay interés." },
  { value: "calificado", label: "Calificado", que: "Cumple el perfil básico: producto, monto y garantía." },
  { value: "solicitud", label: "Solicitud", que: "Solicitud firmada y autorización de buró." },
  { value: "analisis", label: "Análisis", que: "Análisis de riesgo y visita." },
  { value: "oferta", label: "Oferta", que: "Oferta comercial al cliente." },
  { value: "expediente", label: "Expediente", que: "Documentación completa." },
  { value: "comite", label: "Comité", que: "Decisión de crédito." },
  { value: "formalizacion", label: "Formalización", que: "Contrato, firma y garantía." },
  { value: "dispersado", label: "Dispersado", que: "El crédito ya está en SIAC." },
  { value: "pospuesto", label: "Pospuesto", que: "No ahora; se vuelve a buscar después." },
  { value: "rechazado", label: "Rechazado", que: "Se cierra." },
];

export const ETIQUETA_ETAPA = Object.fromEntries(ETAPAS_NEGOCIO.map((e) => [e.value, e.label])) as Record<EtapaNegocio, string>;

/** Las del tablero: de prospecto a formalización. */
export const ETAPAS_ABIERTAS: EtapaNegocio[] = ["prospecto", "calificado", "solicitud", "analisis", "oferta", "expediente", "comite", "formalizacion"];
export const CIERRES: EtapaNegocio[] = ["pospuesto", "rechazado"];
const ORDEN = new Map(ETAPAS_NEGOCIO.map((e, i) => [e.value, i]));

export const estaAbierto = (e: EtapaNegocio) => ETAPAS_ABIERTAS.includes(e);

export type OrigenNegocio = "leads" | "credit_health" | "broker" | "renovacion" | "web" | "marketing" | "outbound" | "referido" | "pymio" | "manual";

export const ORIGENES_NEGOCIO: Record<OrigenNegocio, string> = {
  broker: "Broker",
  leads: "Leads (prospección)",
  credit_health: "Credit Health",
  renovacion: "Renovación",
  pymio: "Pymio",
  outbound: "Outbound",
  web: "Página web",
  marketing: "Marketing",
  referido: "Referido",
  manual: "Otro",
};

export type TipoNegocio = "nuevo" | "renovacion" | "incremento";

export const TIPOS_NEGOCIO: Record<TipoNegocio, string> = {
  nuevo: "Crédito nuevo",
  renovacion: "Renovación",
  incremento: "Incremento",
};

/** Tope del monto estimado, para atrapar dedazos (un cero de más). */
export const MONTO_MAXIMO = 50_000_000;

const limpio = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const CORREO = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface DatosEmpresaNueva {
  nombre: string;
  razonSocial: string | null;
  rfc: string | null;
}

export interface DatosContacto {
  nombre: string;
  puesto: string | null;
  telefono: string | null;
  correo: string | null;
}

export interface DatosNegocio {
  /** Empresa que ya existe en Clientes, o una nueva que se da de alta como prospecto. */
  empresa: { id: string } | { nueva: DatosEmpresaNueva };
  /** Persona de contacto; solo para una empresa nueva. */
  contacto: DatosContacto | null;
  tipo: TipoNegocio;
  origen: OrigenNegocio;
  montoEstimado: number | null;
  responsableEmail: string | null;
  notas: string | null;
}

export type Validado<T> = { ok: true; datos: T } | { ok: false; error: string };

/** Monto escrito como «1,500,000», «$1500000» o «1500000.50». Vacío = null. */
export function leerMonto(v: unknown): number | null | "invalido" {
  const t = limpio(v).replace(/[$,\s]/g, "");
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : "invalido";
}

/** Teléfono a 10 dígitos (quita espacios, guiones y el 52 o +52 de México). */
export function leerTelefono(v: unknown): string | null | "invalido" {
  const d = limpio(v).replace(/\D/g, "");
  if (!d) return null;
  const n = d.length === 12 && d.startsWith("52") ? d.slice(2) : d;
  return n.length === 10 ? n : "invalido";
}

/** Valida el alta de un negocio (y, si va, de su empresa prospecto y su contacto). */
export function validarNegocio(entrada: Record<string, unknown>): Validado<DatosNegocio> {
  let empresa: DatosNegocio["empresa"];
  let contacto: DatosContacto | null = null;
  const empresaId = limpio(entrada.empresaId);
  if (empresaId) {
    if (!/^[0-9a-f-]{36}$/i.test(empresaId)) return { ok: false, error: "Esa empresa no es válida." };
    empresa = { id: empresaId };
  } else {
    const nombre = limpio(entrada.empresaNombre);
    if (!nombre) return { ok: false, error: "Elige una empresa de Clientes o escribe el nombre de la nueva." };
    if (nombre.length > 200) return { ok: false, error: "El nombre de la empresa es demasiado largo (máximo 200 caracteres)." };
    const rfc = validarRfc(limpio(entrada.empresaRfc));
    if (!rfc.ok) return { ok: false, error: rfc.error };
    empresa = { nueva: { nombre, razonSocial: limpio(entrada.empresaRazonSocial) || null, rfc: rfc.rfc } };

    const cNombre = limpio(entrada.contactoNombre);
    const telefono = leerTelefono(entrada.contactoTelefono);
    const correo = limpio(entrada.contactoCorreo).toLowerCase() || null;
    if (telefono === "invalido") return { ok: false, error: "El teléfono debe tener 10 dígitos." };
    if (correo && !CORREO.test(correo)) return { ok: false, error: "El correo no es válido." };
    if (!cNombre && (telefono || correo)) return { ok: false, error: "Escribe el nombre de la persona de contacto." };
    if (cNombre) contacto = { nombre: cNombre.slice(0, 150), puesto: limpio(entrada.contactoPuesto).slice(0, 120) || null, telefono, correo };
  }

  const tipo = (limpio(entrada.tipo) || "nuevo") as TipoNegocio;
  if (!(tipo in TIPOS_NEGOCIO)) return { ok: false, error: "El tipo de negocio no es válido." };
  if ("nueva" in empresa && tipo !== "nuevo") return { ok: false, error: "Una empresa nueva solo puede tener un crédito nuevo." };
  const origen = limpio(entrada.origen) as OrigenNegocio;
  if (!(origen in ORIGENES_NEGOCIO)) return { ok: false, error: "Elige de dónde llegó el negocio." };
  const monto = leerMonto(entrada.montoEstimado);
  if (monto === "invalido") return { ok: false, error: "El monto no es válido. Escríbelo sin letras, por ejemplo 1,500,000." };
  if (monto !== null && monto > MONTO_MAXIMO) return { ok: false, error: `El monto pasa de ${MONTO_MAXIMO.toLocaleString("es-MX")}. Revisa que no sobre un cero.` };
  const responsable = limpio(entrada.responsableEmail).toLowerCase() || null;
  if (responsable && !CORREO.test(responsable)) return { ok: false, error: "El responsable no es válido." };
  const notas = limpio(entrada.notas) || null;
  if (notas && notas.length > 4000) return { ok: false, error: "Las notas son demasiado largas (máximo 4,000 caracteres)." };

  return { ok: true, datos: { empresa, contacto, tipo, origen, montoEstimado: monto, responsableEmail: responsable, notas } };
}

/**
 * Revisa un cambio de etapa. Dispersado no se puede dejar (el crédito ya está
 * en SIAC). Pide motivo al posponer, al rechazar y al regresar a una etapa
 * anterior. Reabrir un pospuesto o un rechazado es avanzar a una etapa abierta.
 */
export function validarCambioEtapa(actual: EtapaNegocio, nueva: string, motivo: string): Validado<{ etapa: EtapaNegocio; motivo: string | null }> {
  if (!ORDEN.has(nueva as EtapaNegocio)) return { ok: false, error: "Esa etapa no existe." };
  const etapa = nueva as EtapaNegocio;
  if (etapa === actual) return { ok: false, error: "El negocio ya está en esa etapa." };
  if (actual === "dispersado") return { ok: false, error: "Un negocio dispersado ya no cambia de etapa: el crédito ya está en SIAC." };
  const m = motivo.trim();
  if (m.length > 1000) return { ok: false, error: "El motivo es demasiado largo (máximo 1,000 caracteres)." };
  const regresa = estaAbierto(actual) && estaAbierto(etapa) && ORDEN.get(etapa)! < ORDEN.get(actual)!;
  if ((CIERRES.includes(etapa) || regresa) && !m) {
    return { ok: false, error: etapa === "pospuesto" ? "Escribe por qué se pospone." : etapa === "rechazado" ? "Escribe por qué se rechaza." : "Escribe por qué regresa a una etapa anterior." };
  }
  return { ok: true, datos: { etapa, motivo: m || null } };
}

const MS_DIA = 86_400_000;

/** Días completos en su etapa actual, contados por fecha (hoy = YYYY-MM-DD de México). */
export function diasEnEtapa(etapaDesde: string, hoy: string): number {
  return Math.max(0, Math.round((Date.parse(`${hoy}T00:00:00Z`) - Date.parse(`${etapaDesde.slice(0, 10)}T00:00:00Z`)) / MS_DIA));
}

export interface NegocioResumen {
  etapa: EtapaNegocio;
  montoEstimado: number | null;
}

/** Cuántos negocios y cuánto monto estimado hay en cada etapa. */
export function totalesPorEtapa(negocios: NegocioResumen[]): Record<EtapaNegocio, { n: number; monto: number }> {
  const t = Object.fromEntries(ETAPAS_NEGOCIO.map((e) => [e.value, { n: 0, monto: 0 }])) as Record<EtapaNegocio, { n: number; monto: number }>;
  for (const x of negocios) {
    t[x.etapa].n++;
    t[x.etapa].monto = Math.round((t[x.etapa].monto + (x.montoEstimado ?? 0)) * 100) / 100;
  }
  return t;
}
