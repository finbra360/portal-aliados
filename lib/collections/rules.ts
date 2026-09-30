// Reglas determinísticas de cobranza. Funciones puras, sin acceso a base de
// datos ni a SIAC, para poder probarlas con `node --test` y auditarlas: cada
// evento o alerta sale de una regla escrita aquí, no de un modelo.

/** Umbral por defecto; el vigente vive en col_settings.umbral_mora. */
export const UMBRAL_MORA_DEFAULT = 1000;
/** Días después de la fecha compromiso antes de marcar una promesa como incumplida. */
export const GRACIA_PROMESA_DIAS = 1;

const CENTAVO = 0.005;

// ---------------------------------------------------------------- fechas

/** Fecha "YYYY-MM-DD" en hora de Ciudad de México (sin horario de verano desde 2022). */
export function fechaMexico(ahora: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Mexico_City",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(ahora);
}

export function addDays(fecha: string, dias: number): string {
  const d = new Date(`${fecha}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

export function daysBetween(desde: string, hasta: string): number {
  return Math.round((Date.parse(`${hasta}T00:00:00Z`) - Date.parse(`${desde}T00:00:00Z`)) / 86_400_000);
}

// ---------------------------------------------------------------- teléfonos

/**
 * Normaliza un teléfono mexicano al formato de WhatsApp: 52 + 10 dígitos.
 * Acepta "55 1234 5678", "+52 55...", "521 55..." (formato viejo de celular).
 * Regresa null si no quedan exactamente 10 dígitos nacionales: ese teléfono
 * hay que corregirlo en SIAC.
 */
export function normalizePhoneMx(raw: string | null | undefined): string | null {
  let d = String(raw ?? "").replace(/\D/g, "");
  if (d.length === 13 && d.startsWith("521")) d = d.slice(3);
  else if (d.length === 12 && d.startsWith("52")) d = d.slice(2);
  return d.length === 10 ? `52${d}` : null;
}

/**
 * El teléfono del titular al que se manda WhatsApp: Celular y, si viene vacío
 * (lo más común en SIAC), TelefonoCliente. Si el campo elegido no tiene 10
 * dígitos no se intenta con el otro: se marca para corregir.
 */
export function campoTelefonoPrincipal(c: { celular: string | null; telefonoCliente: string | null }): "Celular" | "TelefonoCliente" | null {
  if (c.celular && c.celular.replace(/\D/g, "")) return "Celular";
  if (c.telefonoCliente && c.telefonoCliente.replace(/\D/g, "")) return "TelefonoCliente";
  return null;
}

// ---------------------------------------------------------------- buckets

export type Bucket = "al_corriente" | "1-7" | "8-30" | "31-60" | "61-90" | "90+";
export const BUCKETS: Bucket[] = ["al_corriente", "1-7", "8-30", "31-60", "61-90", "90+"];

/** Bucket de aging a partir de `Antiguedad` (días de atraso de SIAC). */
export function bucketFor(antiguedad: number): Bucket {
  if (antiguedad < 1) return "al_corriente";
  if (antiguedad <= 7) return "1-7";
  if (antiguedad <= 30) return "8-30";
  if (antiguedad <= 60) return "31-60";
  if (antiguedad <= 90) return "61-90";
  return "90+";
}

// ---------------------------------------------------------------- eventos de un crédito

/** Lo mínimo de una foto del listado que necesitan las reglas. */
export interface CreditState {
  fechaCorte: string;
  antiguedad: number;
  totalVencido: number;
  vencimientosVencidos: number | null;
  fechaUltimoPago: string | null;
}

export type CreditEventTipo = "pago_detectado" | "entrada_mora" | "regularizacion" | "nueva_mensualidad_vencida";

export interface DerivedEvent {
  tipo: CreditEventTipo;
  fechaEvento: string;
  antiguedadAntes: number;
  antiguedadDespues: number;
  vencidoAntes: number;
  vencidoDespues: number;
}

/**
 * Compara la foto de hoy de un crédito con la anterior (no importa si hay
 * días de por medio) y regresa lo que pasó.
 *
 * - pago_detectado: cambió FechaUltimoPago. Sin monto: el listado no lo trae.
 * - entrada_mora: pasó de 0 a >0 días de atraso. La fecha es la de corte
 *   menos la antigüedad, así que es exacta aunque falten fotos.
 * - regularizacion: pasó de >0 a 0 días de atraso.
 * - nueva_mensualidad_vencida: ya estaba en atraso y subieron los
 *   vencimientos vencidos (venció otra mensualidad sin pagarse).
 *
 * Sin foto anterior (primera vez que se ve el crédito) no hay eventos: lo que
 * ya estaba vencido se ve en la foto misma, con su antigüedad.
 */
export function deriveCreditEvents(prev: CreditState | null, curr: CreditState): DerivedEvent[] {
  if (!prev) return [];
  const base = {
    antiguedadAntes: prev.antiguedad,
    antiguedadDespues: curr.antiguedad,
    vencidoAntes: prev.totalVencido,
    vencidoDespues: curr.totalVencido,
  };
  const events: DerivedEvent[] = [];

  if (curr.fechaUltimoPago && curr.fechaUltimoPago !== prev.fechaUltimoPago && (!prev.fechaUltimoPago || curr.fechaUltimoPago > prev.fechaUltimoPago)) {
    events.push({ tipo: "pago_detectado", fechaEvento: curr.fechaUltimoPago, ...base });
  }
  if (prev.antiguedad === 0 && curr.antiguedad > 0) {
    events.push({ tipo: "entrada_mora", fechaEvento: addDays(curr.fechaCorte, -curr.antiguedad), ...base });
  }
  if (prev.antiguedad > 0 && curr.antiguedad === 0) {
    events.push({ tipo: "regularizacion", fechaEvento: curr.fechaCorte, ...base });
  }
  if (
    prev.antiguedad > 0 &&
    curr.antiguedad > 0 &&
    prev.vencimientosVencidos !== null &&
    curr.vencimientosVencidos !== null &&
    curr.vencimientosVencidos > prev.vencimientosVencidos
  ) {
    events.push({ tipo: "nueva_mensualidad_vencida", fechaEvento: curr.fechaCorte, ...base });
  }
  return events;
}

// ---------------------------------------------------------------- foto vieja

/**
 * ¿SIAC regresó la misma foto que la anterior? Pasa si el Monitor de
 * Servicios no corrió a las 00:00. Un crédito en atraso siempre cambia de un
 * día a otro (suben los días de atraso y los moratorios), así que si hay al
 * menos uno en atraso y NINGÚN crédito cambió nada, la foto es vieja.
 *
 * Sin créditos en atraso no hay forma de saberlo: se regresa "sin_evidencia"
 * y la foto se acepta.
 */
export function photoFreshness(
  prev: Map<string, CreditState>,
  curr: Map<string, CreditState>,
): "actualizada" | "vieja" | "sin_evidencia" {
  if (prev.size === 0) return "sin_evidencia";
  let comparables = 0;
  let enAtraso = 0;
  for (const [id, c] of curr) {
    const p = prev.get(id);
    if (!p) return "actualizada"; // apareció un crédito nuevo
    if (p.fechaCorte === c.fechaCorte) continue;
    comparables++;
    if (p.antiguedad > 0) enAtraso++;
    const igual =
      p.antiguedad === c.antiguedad &&
      Math.abs(p.totalVencido - c.totalVencido) < CENTAVO &&
      p.fechaUltimoPago === c.fechaUltimoPago &&
      p.vencimientosVencidos === c.vencimientosVencidos;
    if (!igual) return "actualizada";
  }
  for (const id of prev.keys()) if (!curr.has(id)) return "actualizada"; // salió un crédito
  return comparables > 0 && enAtraso > 0 ? "vieja" : "sin_evidencia";
}

// ---------------------------------------------------------------- alertas por cliente

export type AlertTipo =
  | "entrada_mora"
  | "nueva_mensualidad_vencida"
  | "cambio_bucket"
  | "promesa_incumplida"
  | "mensaje_fallido"
  | "telefono_invalido"
  | "sync_fallido"
  | "foto_vieja";

export interface AlertDraft {
  tipo: AlertTipo;
  severidad: "info" | "atencion" | "critica";
  dedupeKey: string;
  detalle: Record<string, unknown>;
}

/** Totales de un cliente en una foto: la mora se decide por cliente, no por crédito. */
export interface ClientState {
  totalVencido: number;
  maxAntiguedad: number;
  vencimientosVencidos: number;
}

export function aggregateClient(creditos: CreditState[]): ClientState {
  return {
    totalVencido: Math.round(creditos.reduce((s, c) => s + c.totalVencido, 0) * 100) / 100,
    maxAntiguedad: creditos.reduce((m, c) => Math.max(m, c.antiguedad), 0),
    vencimientosVencidos: creditos.reduce((s, c) => s + (c.vencimientosVencidos ?? 0), 0),
  };
}

/**
 * Alertas de un cliente al comparar su foto de hoy con la anterior:
 * - entrada_mora: su saldo vencido total cruza el umbral (por debajo son residuos).
 * - nueva_mensualidad_vencida: ya estaba en mora y venció otra mensualidad sin pago.
 * - cambio_bucket: su crédito más atrasado pasa a 31-60, 61-90 o 90+. Los
 *   buckets menores ya los cubre entrada_mora.
 */
export function deriveClientAlerts(
  prev: ClientState | null,
  curr: ClientState,
  clientId: string,
  umbral: number,
  fechaCorte: string,
): AlertDraft[] {
  if (!prev) return [];
  const alerts: AlertDraft[] = [];
  const enMoraAntes = prev.totalVencido >= umbral;
  const enMoraAhora = curr.totalVencido >= umbral;

  if (!enMoraAntes && enMoraAhora) {
    alerts.push({
      tipo: "entrada_mora",
      severidad: "atencion",
      dedupeKey: `entrada_mora:${clientId}`,
      detalle: { fecha: fechaCorte, totalVencido: curr.totalVencido, diasAtraso: curr.maxAntiguedad },
    });
  }
  if (enMoraAntes && enMoraAhora && curr.vencimientosVencidos > prev.vencimientosVencidos) {
    alerts.push({
      tipo: "nueva_mensualidad_vencida",
      severidad: "atencion",
      dedupeKey: `nueva_mensualidad_vencida:${clientId}`,
      detalle: { fecha: fechaCorte, vencimientosVencidos: curr.vencimientosVencidos, totalVencido: curr.totalVencido },
    });
  }
  const bAntes = BUCKETS.indexOf(bucketFor(prev.maxAntiguedad));
  const bAhora = BUCKETS.indexOf(bucketFor(curr.maxAntiguedad));
  if (enMoraAhora && bAhora > bAntes && bAhora >= BUCKETS.indexOf("31-60")) {
    const bucket = BUCKETS[bAhora];
    alerts.push({
      tipo: "cambio_bucket",
      severidad: bucket === "90+" ? "critica" : "atencion",
      dedupeKey: `cambio_bucket:${clientId}:${bucket}`,
      detalle: { fecha: fechaCorte, bucketAntes: BUCKETS[bAntes], bucketAhora: bucket, diasAtraso: curr.maxAntiguedad },
    });
  }
  return alerts;
}

// ---------------------------------------------------------------- promesas

export type PromiseEstado = "vigente" | "cumplida" | "parcial" | "incumplida";

/**
 * Resuelve una promesa con los pagos de SIAC (ConsultarPagos), con monto.
 *
 * Cuentan los pagos aplicados desde el día en que se registró la promesa
 * hasta la fecha compromiso + GRACIA_PROMESA_DIAS. `datosHasta` es la fecha
 * de corte de la última foto (no la fecha de hoy): la promesa solo se da por
 * incumplida o parcial cuando ya tenemos datos de todo el periodo de gracia.
 */
export function resolvePromiseConPagos(
  promesa: { monto: number; creadaEl: string; fechaCompromiso: string },
  pagos: { fecha: string; monto: number }[],
  datosHasta: string,
): { estado: PromiseEstado; montoPagado: number } {
  const limite = addDays(promesa.fechaCompromiso, GRACIA_PROMESA_DIAS);
  const montoPagado =
    Math.round(pagos.filter((p) => p.fecha >= promesa.creadaEl && p.fecha <= limite).reduce((s, p) => s + p.monto, 0) * 100) / 100;
  if (montoPagado >= promesa.monto - CENTAVO) return { estado: "cumplida", montoPagado };
  if (datosHasta >= limite) return { estado: montoPagado > CENTAVO ? "parcial" : "incumplida", montoPagado };
  return { estado: "vigente", montoPagado };
}

/**
 * Respaldo cuando faltan los montos de pago (un crédito con pago detectado
 * cuya historia no se pudo traer de ConsultarPagos). Es una aproximación y se
 * puede corregir a mano:
 *
 * - cumplida: hubo pago en la ventana y el vencido bajó al menos el monto
 *   prometido, o quedó por debajo del umbral de mora.
 * - parcial: hubo pago en la ventana, pero no alcanzó.
 * - incumplida: no hubo pago y ya tenemos fotos de todo el periodo de gracia.
 */
export function resolvePromiseAproximada(
  promesa: { monto: number; creadaEl: string; fechaCompromiso: string; vencidoAlCrear: number },
  fechasPago: string[],
  vencidoActual: number,
  datosHasta: string,
  umbral: number,
): PromiseEstado {
  const limite = addDays(promesa.fechaCompromiso, GRACIA_PROMESA_DIAS);
  const pago = fechasPago.some((f) => f >= promesa.creadaEl && f <= limite);
  if (pago) {
    const bajo = promesa.vencidoAlCrear - vencidoActual;
    return bajo >= promesa.monto - CENTAVO || vencidoActual < umbral ? "cumplida" : datosHasta >= limite ? "parcial" : "vigente";
  }
  return datosHasta >= limite ? "incumplida" : "vigente";
}
