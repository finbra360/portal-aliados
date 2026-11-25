// Negocios de crédito (originación): una solicitud de una empresa desde el
// primer contacto hasta el crédito dispersado en SIAC. Reemplaza al pipeline
// de negocios de HubSpot. Ver crm_negocios_credito en lib/db/crm-schema.sql.
// Funciones puras, sin base de datos, para probarlas con `node --test`.

import { validarRfc } from "./rfc.ts";
import type { DecisionComite, RespuestaOferta, ResultadoBuro } from "./comite.ts";

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

/**
 * Orígenes que pueden tener broker: los que trajo un broker y las renovaciones
 * de clientes que llegaron por uno (a ese broker le toca la colocación).
 */
export const admiteBroker = (origen: string) => origen === "broker" || origen === "renovacion";

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
  /** Broker que lo trajo (obligatorio si el origen es «broker»). */
  brokerId: string | null;
}

/** Id de broker: el código de Lendia o el B### del backoffice. */
const BROKER_ID = /^[A-Za-z0-9_-]{1,40}$/;

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
  const brokerId = limpio(entrada.brokerId) || null;
  if (brokerId && !BROKER_ID.test(brokerId)) return { ok: false, error: "El broker no es válido." };
  if (origen === "broker" && !brokerId) return { ok: false, error: "Elige de qué broker viene el negocio." };

  return { ok: true, datos: { empresa, contacto, tipo, origen, montoEstimado: monto, responsableEmail: responsable, notas, brokerId: origen === "broker" ? brokerId : null } };
}

// ---------------------------------------------------------------- solicitud (fase O2)

export type Producto = "pyme" | "simple" | "arrendamiento";
export const PRODUCTOS: Record<Producto, string> = { pyme: "Crédito PyME", simple: "Crédito simple", arrendamiento: "Arrendamiento" };

export type Destino = "capital_trabajo" | "compra_activo" | "refinanciamiento" | "expansion" | "otro";
export const DESTINOS: Record<Destino, string> = {
  capital_trabajo: "Capital de trabajo",
  compra_activo: "Compra de activo (vehículo, maquinaria)",
  refinanciamiento: "Refinanciamiento de deuda",
  expansion: "Expansión",
  otro: "Otro",
};

export type TipoGarantia = "vehicular" | "inmobiliaria" | "otra" | "sin_garantia";
export const GARANTIAS: Record<TipoGarantia, string> = { vehicular: "Vehicular", inmobiliaria: "Inmobiliaria", otra: "Otra", sin_garantia: "Sin garantía" };

/** Motivos de rechazo, cada uno con quién cerró: Finbra (no aprobó) o el cliente (desistió). */
export const MOTIVOS_RECHAZO: Record<string, { label: string; por: "finbra" | "cliente" }> = {
  capacidad: { label: "Capacidad de pago insuficiente", por: "finbra" },
  buro: { label: "Historial de crédito o buró", por: "finbra" },
  garantia: { label: "Garantía insuficiente o no válida", por: "finbra" },
  politica: { label: "Giro, antigüedad o tamaño fuera de política", por: "finbra" },
  documentacion: { label: "Documentación incompleta o inconsistente", por: "finbra" },
  costo: { label: "Tasa o costo", por: "cliente" },
  monto: { label: "El monto no le alcanza", por: "cliente" },
  otro_financiamiento: { label: "Consiguió otro financiamiento", por: "cliente" },
  ya_no_necesita: { label: "Ya no lo necesita", por: "cliente" },
  no_responde: { label: "Dejó de responder", por: "cliente" },
  tiempos: { label: "Tiempos del proceso", por: "cliente" },
  comite: { label: "Rechazado en comité", por: "finbra" },
};

export interface DatosSolicitud {
  producto: Producto | null;
  montoEstimado: number | null;
  plazoMeses: number | null;
  destino: Destino | null;
  destinoDetalle: string | null;
  garantiaTipo: TipoGarantia | null;
  garantiaDetalle: string | null;
  garantiaValor: number | null;
  /** % de comisión por apertura pactado con el cliente (define la comisión del broker). */
  comisionAperturaPct: number | null;
}

/** Valida los datos de la solicitud. Todos son opcionales aquí; cada etapa pide los suyos (faltantesPara). */
export function validarSolicitud(entrada: Record<string, unknown>): Validado<DatosSolicitud> {
  const producto = limpio(entrada.producto);
  if (producto && !(producto in PRODUCTOS)) return { ok: false, error: "El producto no es válido." };
  const monto = leerMonto(entrada.montoEstimado);
  if (monto === "invalido") return { ok: false, error: "El monto no es válido. Escríbelo sin letras, por ejemplo 1,500,000." };
  if (monto !== null && monto > MONTO_MAXIMO) return { ok: false, error: `El monto pasa de ${MONTO_MAXIMO.toLocaleString("es-MX")}. Revisa que no sobre un cero.` };
  const plazoTxt = limpio(entrada.plazoMeses);
  const plazo = plazoTxt ? Number(plazoTxt) : null;
  if (plazo !== null && (!Number.isInteger(plazo) || plazo < 1 || plazo > 120)) return { ok: false, error: "El plazo va de 1 a 120 meses." };
  const destino = limpio(entrada.destino);
  if (destino && !(destino in DESTINOS)) return { ok: false, error: "El destino no es válido." };
  const garantia = limpio(entrada.garantiaTipo);
  if (garantia && !(garantia in GARANTIAS)) return { ok: false, error: "El tipo de garantía no es válido." };
  const valor = leerMonto(entrada.garantiaValor);
  if (valor === "invalido") return { ok: false, error: "El valor de la garantía no es válido." };
  if (valor !== null && valor > MONTO_MAXIMO * 4) return { ok: false, error: "El valor de la garantía es demasiado alto. Revisa que no sobre un cero." };
  const destinoDetalle = limpio(entrada.destinoDetalle) || null;
  const garantiaDetalle = limpio(entrada.garantiaDetalle) || null;
  if ((destinoDetalle?.length ?? 0) > 500 || (garantiaDetalle?.length ?? 0) > 500) return { ok: false, error: "El detalle es demasiado largo (máximo 500 caracteres)." };
  const comisionTxt = limpio(entrada.comisionAperturaPct).replace("%", "");
  const comision = comisionTxt ? Number(comisionTxt) : null;
  if (comision !== null && (!Number.isFinite(comision) || comision < 0 || comision > 20 || Math.round(comision * 100) !== comision * 100)) {
    return { ok: false, error: "La comisión por apertura va de 0 a 20 %, con hasta dos decimales." };
  }
  return {
    ok: true,
    datos: {
      producto: (producto || null) as Producto | null,
      montoEstimado: monto,
      plazoMeses: plazo,
      destino: (destino || null) as Destino | null,
      destinoDetalle,
      garantiaTipo: (garantia || null) as TipoGarantia | null,
      garantiaDetalle: garantia === "sin_garantia" ? null : garantiaDetalle,
      garantiaValor: garantia === "sin_garantia" ? null : valor,
      comisionAperturaPct: comision,
    },
  };
}

/** Lo que hace falta saber del negocio para decidir si puede avanzar. */
export interface ParaRequisitos {
  producto: Producto | null;
  montoEstimado: number | null;
  plazoMeses: number | null;
  destino: Destino | null;
  garantiaTipo: TipoGarantia | null;
  rfcEmpresa: string | null;
  /** Análisis, oferta, expediente y comité (fase O5). null o ausente: la base todavía no los tiene y no se piden. */
  proceso?: DatosProceso | null;
}

export interface DatosProceso {
  buroResultado: ResultadoBuro | null;
  capacidadPagoMensual: number | null;
  garantiaValor: number | null;
  ofertaMonto: number | null;
  ofertaTasaAnual: number | null;
  ofertaPlazoMeses: number | null;
  comisionAperturaPct: number | null;
  ofertaRespuesta: RespuestaOferta | null;
  expedienteUrl: string | null;
  /** Documentos de la lista del producto que siguen pendientes. */
  documentosPendientes: number;
  /** Última decisión del comité. */
  decision: DecisionComite | null;
}

/** Datos mínimos de cada etapa; las siguientes heredan los de las anteriores. */
const REQUISITOS: { desde: EtapaNegocio; texto: string; cumple: (n: ParaRequisitos) => boolean }[] = [
  { desde: "calificado", texto: "producto", cumple: (n) => !!n.producto },
  { desde: "calificado", texto: "monto estimado", cumple: (n) => n.montoEstimado !== null },
  { desde: "calificado", texto: "tipo de garantía", cumple: (n) => !!n.garantiaTipo },
  { desde: "solicitud", texto: "RFC de la empresa", cumple: (n) => !!n.rfcEmpresa },
  { desde: "solicitud", texto: "plazo", cumple: (n) => n.plazoMeses !== null },
  { desde: "solicitud", texto: "destino del crédito", cumple: (n) => !!n.destino },
];

/**
 * Pasos del proceso (fase O5): se piden al cruzar la etapa, no después. Un
 * negocio que ya estaba más adelante (migrado de Operaciones o anterior a O5)
 * no tiene que capturarlos para seguir avanzando.
 */
const PASOS: { desde: EtapaNegocio; texto: (p: DatosProceso) => string; cumple: (p: DatosProceso, n: ParaRequisitos) => boolean }[] = [
  { desde: "oferta", texto: () => "resultado de buró", cumple: (p) => !!p.buroResultado },
  { desde: "oferta", texto: () => "capacidad de pago", cumple: (p) => p.capacidadPagoMensual !== null },
  { desde: "oferta", texto: () => "valor de la garantía", cumple: (p, n) => n.garantiaTipo === "sin_garantia" || p.garantiaValor !== null },
  {
    desde: "expediente",
    texto: () => "la oferta completa (monto, tasa, plazo y comisión)",
    cumple: (p) => p.ofertaMonto !== null && p.ofertaTasaAnual !== null && p.ofertaPlazoMeses !== null && p.comisionAperturaPct !== null,
  },
  { desde: "expediente", texto: () => "que el cliente acepte la oferta", cumple: (p) => p.ofertaRespuesta === "aceptada" },
  { desde: "comite", texto: () => "la liga a la carpeta del expediente", cumple: (p) => !!p.expedienteUrl },
  {
    desde: "comite",
    texto: (p) => (p.documentosPendientes === 1 ? "1 documento del expediente" : `${p.documentosPendientes} documentos del expediente`),
    cumple: (p) => p.documentosPendientes === 0,
  },
  { desde: "formalizacion", texto: () => "la aprobación del comité", cumple: (p) => p.decision === "aprobado" },
];

/**
 * Lo que le falta al negocio para estar en `etapa` (vacío si no le falta nada
 * o si es un cierre). Con `actual`, los pasos del proceso solo se piden si el
 * negocio todavía no los había cruzado; un pospuesto o rechazado que se reabre
 * los tiene que cumplir todos.
 */
export function faltantesPara(etapa: EtapaNegocio, n: ParaRequisitos, actual?: EtapaNegocio): string[] {
  if (CIERRES.includes(etapa)) return [];
  const hasta = ORDEN.get(etapa)!;
  const datos = REQUISITOS.filter((r) => ORDEN.get(r.desde)! <= hasta && !r.cumple(n)).map((r) => r.texto);
  const p = n.proceso;
  if (!p) return datos;
  const ya = actual && estaAbierto(actual) ? ORDEN.get(actual)! : -1;
  const pasos = PASOS.filter((r) => ORDEN.get(r.desde)! <= hasta && ORDEN.get(r.desde)! > ya && !r.cumple(p, n)).map((r) => r.texto(p));
  return [...datos, ...pasos];
}

/** Lista legible: «producto, monto estimado y plazo». */
export const listaLegible = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} y ${xs[xs.length - 1]}`);

export interface CambioValidado {
  etapa: EtapaNegocio;
  /** Texto que queda en el historial (y en motivo_cierre si es un cierre). */
  motivo: string | null;
  recontactarEl: string | null;
  rechazoMotivo: string | null;
  rechazoPor: "finbra" | "cliente" | null;
}

const MAX_RECONTACTO_DIAS = 730;

/**
 * Revisa un cambio de etapa. Dispersado no se puede dejar (el crédito ya está
 * en SIAC). Posponer pide motivo y la fecha para volver a contactarlo (después
 * de hoy, a lo más dos años). Rechazar pide un motivo del catálogo (el detalle
 * es opcional). Regresar a una etapa anterior pide motivo. Avanzar, o reabrir
 * un pospuesto o un rechazado, pide los datos de esa etapa (faltantesPara).
 */
export function validarCambioEtapa(
  actual: EtapaNegocio,
  nueva: string,
  entrada: { motivo?: string; recontactarEl?: string; motivoRechazo?: string },
  hoy: string,
  datos: ParaRequisitos,
  /** Lo mueve la decisión del comité: puede rechazar con el motivo «comite». */
  porComite = false,
): Validado<CambioValidado> {
  if (!ORDEN.has(nueva as EtapaNegocio)) return { ok: false, error: "Esa etapa no existe." };
  const etapa = nueva as EtapaNegocio;
  if (etapa === actual) return { ok: false, error: "El negocio ya está en esa etapa." };
  if (actual === "dispersado") return { ok: false, error: "Un negocio dispersado ya no cambia de etapa: el crédito ya está en SIAC." };
  const m = (entrada.motivo ?? "").trim();
  if (m.length > 1000) return { ok: false, error: "El motivo es demasiado largo (máximo 1,000 caracteres)." };
  const base = { etapa, motivo: m || null, recontactarEl: null, rechazoMotivo: null, rechazoPor: null };

  if (etapa === "pospuesto") {
    if (!m) return { ok: false, error: "Escribe por qué se pospone." };
    const f = (entrada.recontactarEl ?? "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(f) || Number.isNaN(Date.parse(`${f}T00:00:00Z`))) return { ok: false, error: "Elige cuándo volver a contactarlo." };
    if (f <= hoy) return { ok: false, error: "La fecha para volver a contactarlo tiene que ser después de hoy." };
    if (diasEnEtapa(hoy, f) > MAX_RECONTACTO_DIAS) return { ok: false, error: "La fecha para volver a contactarlo es de más de dos años; elige una más cercana." };
    return { ok: true, datos: { ...base, recontactarEl: f } };
  }
  if (etapa === "rechazado") {
    const clave = (entrada.motivoRechazo ?? "").trim();
    if (clave === "comite" && !porComite) return { ok: false, error: "El rechazo en comité se registra con la decisión del comité." };
    const motivo = MOTIVOS_RECHAZO[clave];
    if (!motivo) return { ok: false, error: "Elige el motivo del rechazo." };
    return { ok: true, datos: { ...base, motivo: m ? `${motivo.label}: ${m}` : motivo.label, rechazoMotivo: clave, rechazoPor: motivo.por } };
  }

  const regresa = estaAbierto(actual) && ORDEN.get(etapa)! < ORDEN.get(actual)!;
  if (regresa) {
    if (!m) return { ok: false, error: "Escribe por qué regresa a una etapa anterior." };
    return { ok: true, datos: base };
  }
  const faltan = faltantesPara(etapa, datos, actual);
  if (faltan.length) return { ok: false, error: `Para pasar a ${ETIQUETA_ETAPA[etapa]} falta: ${listaLegible(faltan)}.` };
  return { ok: true, datos: base };
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

// ---------------------------------------------------------------- orígenes (fase O3)

/** Destino de Credit Health → destino del negocio (los que no existen aquí se aproximan y se anotan). */
const DESTINO_CH: Record<string, Destino> = {
  capital_trabajo: "capital_trabajo",
  inventario: "capital_trabajo",
  liquidez_puntual: "capital_trabajo",
  maquinaria_equipo: "compra_activo",
  expansion: "expansion",
  refinanciamiento: "refinanciamiento",
  otro: "otro",
};
const GARANTIA_CH: Record<string, TipoGarantia> = { vehicular: "vehicular", inmobiliaria: "inmobiliaria", otra: "otra", ninguna: "sin_garantia" };

const pesosEnteros = (n: number) => `$${Math.round(n).toLocaleString("es-MX")}`;

export interface ProspectoParaNegocio {
  folio: string;
  requestedAmount: number | null;
  termMonths: number | null;
  purpose: string | null;
  /** Etiqueta del destino en Credit Health, para anotarlo si aquí se aproxima. */
  purposeLabel: string | null;
  collateralType: string | null;
  clasificacion: string | null;
  preliminaryAmount: number | null;
  dscrProjected: number | null;
}

/** Solicitud y notas de un negocio que sale de un prospecto de Credit Health (lo que declaró el cliente). */
export function negocioDesdeCreditHealth(p: ProspectoParaNegocio): { solicitud: Partial<DatosSolicitud>; notas: string } {
  const destino = p.purpose ? (DESTINO_CH[p.purpose] ?? "otro") : null;
  const monto = p.requestedAmount !== null && p.requestedAmount > 0 && p.requestedAmount <= MONTO_MAXIMO ? Math.round(p.requestedAmount * 100) / 100 : null;
  const plazo = p.termMonths !== null && Number.isInteger(p.termMonths) && p.termMonths >= 1 && p.termMonths <= 120 ? p.termMonths : null;
  const notas = [
    `Viene de Credit Health, folio ${p.folio}. Datos declarados por el cliente en el diagnóstico.`,
    p.clasificacion && `Clasificación: ${p.clasificacion}.`,
    p.preliminaryAmount !== null && `Monto preliminar del diagnóstico: ${pesosEnteros(p.preliminaryAmount)}.`,
    p.dscrProjected !== null && `DSCR proyectado: ${p.dscrProjected.toFixed(2)}.`,
  ]
    .filter(Boolean)
    .join(" ");
  return {
    solicitud: {
      montoEstimado: monto,
      plazoMeses: plazo,
      destino,
      destinoDetalle: destino && p.purposeLabel && p.purpose !== destino ? p.purposeLabel : null,
      garantiaTipo: p.collateralType ? (GARANTIA_CH[p.collateralType] ?? null) : null,
    },
    notas,
  };
}

export interface LeadParaNegocio {
  empleadosEstimado: number | null;
  ventasEstimadoMxn: number | null;
  antiguedadAnios: number | null;
  tieneGarantiaVehicular: boolean;
  tieneGarantiaInmobiliaria: boolean;
  totalScore: number | null;
  categoria: string | null;
}

/** Solicitud y notas de un negocio que sale de un lead del motor de prospección (estimados, no confirmados). */
export function negocioDesdeLead(l: LeadParaNegocio): { solicitud: Partial<DatosSolicitud>; notas: string } {
  const garantia: TipoGarantia | null = l.tieneGarantiaVehicular ? "vehicular" : l.tieneGarantiaInmobiliaria ? "inmobiliaria" : null;
  const notas = [
    "Viene del motor de prospección (Leads). Las cifras son estimadas, no confirmadas con el cliente.",
    l.empleadosEstimado !== null && `Empleados: ~${l.empleadosEstimado}.`,
    l.ventasEstimadoMxn !== null && `Ventas anuales: ~${pesosEnteros(l.ventasEstimadoMxn)}.`,
    l.antiguedadAnios !== null && `Antigüedad: ~${l.antiguedadAnios} años.`,
    l.tieneGarantiaVehicular && l.tieneGarantiaInmobiliaria && "Podría tener garantía vehicular e inmobiliaria.",
    l.totalScore !== null && `Score ${Math.round(l.totalScore)}${l.categoria ? ` (${l.categoria})` : ""}.`,
  ]
    .filter(Boolean)
    .join(" ");
  return { solicitud: { garantiaTipo: garantia }, notas };
}
