// Reglas determinísticas de cobranza. Funciones puras, sin acceso a base de
// datos ni a SIAC, para poder probarlas con `node --test` y auditarlas: cada
// alerta o evento sale de una regla escrita aquí, no de un modelo.

/** Saldo vencido mínimo para considerar a un cliente en mora (regla del prototipo de n8n). */
export const UMBRAL_MORA = 1000;
/** Días después de la fecha compromiso antes de marcar una promesa como incumplida. */
export const GRACIA_PROMESA_DIAS = 1;
/** Huecos de hasta estos días se rellenan día por día en la foto diaria; más largos van al script de reconstrucción. */
export const MAX_DIAS_RELLENO = 14;

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
 * Regresa null si no quedan exactamente 10 dígitos nacionales.
 */
export function normalizePhoneMx(raw: string | null | undefined): string | null {
  let d = String(raw ?? "").replace(/\D/g, "");
  if (d.length === 13 && d.startsWith("521")) d = d.slice(3);
  else if (d.length === 12 && d.startsWith("52")) d = d.slice(2);
  return d.length === 10 ? `52${d}` : null;
}

// ---------------------------------------------------------------- buckets

export type Bucket = "1-7" | "8-30" | "31-60" | "61-90" | "90+";
export const BUCKETS: Bucket[] = ["1-7", "8-30", "31-60", "61-90", "90+"];

export function bucketFor(diasAtraso: number | null): Bucket | null {
  if (diasAtraso === null || diasAtraso < 1) return null;
  if (diasAtraso <= 7) return "1-7";
  if (diasAtraso <= 30) return "8-30";
  if (diasAtraso <= 60) return "31-60";
  if (diasAtraso <= 90) return "61-90";
  return "90+";
}

// ---------------------------------------------------------------- eventos entre dos fotos

/** Lo mínimo de una foto de saldo que necesitan las reglas. */
export interface DayState {
  fechaCorte: string;
  saldoVencido: number;
  capitalVencido: number;
  sumaPagos: number;
  sumaCondonaciones: number;
  sumaQuitas: number;
  sumaCastigos: number;
  /** Inicio de la racha actual de vencido; null si no hay vencido o si no se conoce. */
  vencidoDesde: string | null;
}

export type CreditEventTipo = "pago" | "entrada_vencido" | "regularizacion" | "condonacion" | "quita" | "castigo";

export interface DerivedEvent {
  tipo: CreditEventTipo;
  fechaEvento: string;
  monto: number | null;
  vencidoAntes: number;
  vencidoDespues: number;
}

/**
 * Compara la foto de un día con la del día inmediatamente anterior y regresa
 * los eventos de ese día y el `vencidoDesde` de la foto nueva.
 *
 * Si no hay foto anterior (primera vez que se ve el crédito), no se generan
 * eventos y, si ya trae vencido, `vencidoDesde` queda null: no sabemos desde
 * cuándo está vencido hasta correr la reconstrucción histórica.
 */
export function deriveDay(
  prev: DayState | null,
  curr: Omit<DayState, "vencidoDesde">,
): { vencidoDesde: string | null; events: DerivedEvent[] } {
  if (!prev) return { vencidoDesde: null, events: [] };

  const base = { fechaEvento: curr.fechaCorte, vencidoAntes: prev.saldoVencido, vencidoDespues: curr.saldoVencido };
  const events: DerivedEvent[] = [];
  const delta = (a: number, b: number) => Math.round((b - a) * 100) / 100;

  const pagos = delta(prev.sumaPagos, curr.sumaPagos);
  if (pagos > CENTAVO) events.push({ tipo: "pago", monto: pagos, ...base });
  const condonaciones = delta(prev.sumaCondonaciones, curr.sumaCondonaciones);
  if (condonaciones > CENTAVO) events.push({ tipo: "condonacion", monto: condonaciones, ...base });
  const quitas = delta(prev.sumaQuitas, curr.sumaQuitas);
  if (quitas > CENTAVO) events.push({ tipo: "quita", monto: quitas, ...base });
  const castigos = delta(prev.sumaCastigos, curr.sumaCastigos);
  if (castigos > CENTAVO) events.push({ tipo: "castigo", monto: castigos, ...base });

  const antesVencido = prev.saldoVencido > CENTAVO;
  const ahoraVencido = curr.saldoVencido > CENTAVO;
  if (!antesVencido && ahoraVencido) events.push({ tipo: "entrada_vencido", monto: curr.saldoVencido, ...base });
  if (antesVencido && !ahoraVencido) events.push({ tipo: "regularizacion", monto: null, ...base });

  const vencidoDesde = ahoraVencido ? (antesVencido ? prev.vencidoDesde : curr.fechaCorte) : null;
  return { vencidoDesde, events };
}

// ---------------------------------------------------------------- alertas

export type AlertTipo =
  | "entrada_vencido"
  | "aumento_vencido"
  | "cambio_bucket"
  | "promesa_incumplida"
  | "mensaje_fallido"
  | "telefono_invalido"
  | "sync_fallido";

export interface AlertDraft {
  tipo: AlertTipo;
  severidad: "info" | "atencion" | "critica";
  dedupeKey: string;
  detalle: Record<string, unknown>;
}

export function diasAtraso(state: Pick<DayState, "fechaCorte" | "vencidoDesde">): number | null {
  return state.vencidoDesde ? daysBetween(state.vencidoDesde, state.fechaCorte) : null;
}

/**
 * Alertas de un crédito al pasar de un día al siguiente:
 * - entrada_vencido: el saldo vencido cruza el umbral de mora.
 * - aumento_vencido: ya estaba en mora y creció el CAPITAL vencido (venció otra
 *   mensualidad sin pagarse). No se usa el saldo vencido total porque los
 *   moratorios lo hacen crecer todos los días y la alerta sería ruido.
 * - cambio_bucket: pasa a 31-60, 61-90 o 90+. Los buckets menores ya los
 *   cubre entrada_vencido.
 */
export function deriveCreditAlerts(prev: DayState | null, curr: DayState, creditId: string): AlertDraft[] {
  if (!prev) return [];
  const alerts: AlertDraft[] = [];
  const enMoraAntes = prev.saldoVencido >= UMBRAL_MORA;
  const enMoraAhora = curr.saldoVencido >= UMBRAL_MORA;

  if (!enMoraAntes && enMoraAhora) {
    alerts.push({
      tipo: "entrada_vencido",
      severidad: "atencion",
      dedupeKey: `entrada_vencido:${creditId}`,
      detalle: { fecha: curr.fechaCorte, saldoVencido: curr.saldoVencido },
    });
  }

  if (enMoraAntes && enMoraAhora && curr.capitalVencido - prev.capitalVencido > CENTAVO) {
    alerts.push({
      tipo: "aumento_vencido",
      severidad: "atencion",
      dedupeKey: `aumento_vencido:${creditId}`,
      detalle: {
        fecha: curr.fechaCorte,
        capitalVencidoAntes: prev.capitalVencido,
        capitalVencidoAhora: curr.capitalVencido,
      },
    });
  }

  const bucketAntes = bucketFor(diasAtraso(prev));
  const bucketAhora = bucketFor(diasAtraso(curr));
  if (
    enMoraAhora &&
    bucketAhora &&
    bucketAhora !== bucketAntes &&
    BUCKETS.indexOf(bucketAhora) >= BUCKETS.indexOf("31-60") &&
    (bucketAntes === null || BUCKETS.indexOf(bucketAhora) > BUCKETS.indexOf(bucketAntes))
  ) {
    alerts.push({
      tipo: "cambio_bucket",
      severidad: bucketAhora === "90+" ? "critica" : "atencion",
      dedupeKey: `cambio_bucket:${creditId}:${bucketAhora}`,
      detalle: { fecha: curr.fechaCorte, bucketAntes, bucketAhora, diasAtraso: diasAtraso(curr) },
    });
  }

  return alerts;
}

// ---------------------------------------------------------------- promesas

export type PromiseEstado = "vigente" | "cumplida" | "parcial" | "incumplida";

/**
 * Resuelve una promesa con los pagos que detectó SIAC.
 *
 * Cuentan los pagos desde el día en que se registró la promesa hasta la fecha
 * compromiso + GRACIA_PROMESA_DIAS. `datosHasta` es la fecha de corte de la
 * última foto (no la fecha de hoy): la promesa solo se da por incumplida
 * cuando ya tenemos datos de SIAC de todo el periodo de gracia.
 */
export function resolvePromise(
  promesa: { monto: number; creadaEl: string; fechaCompromiso: string },
  pagos: { fecha: string; monto: number }[],
  datosHasta: string,
): { estado: PromiseEstado; montoPagado: number } {
  const limite = addDays(promesa.fechaCompromiso, GRACIA_PROMESA_DIAS);
  const montoPagado =
    Math.round(
      pagos.filter((p) => p.fecha >= promesa.creadaEl && p.fecha <= limite).reduce((s, p) => s + p.monto, 0) * 100,
    ) / 100;

  if (montoPagado >= promesa.monto - CENTAVO) return { estado: "cumplida", montoPagado };
  if (datosHasta >= limite) return { estado: montoPagado > CENTAVO ? "parcial" : "incumplida", montoPagado };
  return { estado: "vigente", montoPagado };
}
