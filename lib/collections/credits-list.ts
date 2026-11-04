// Lista de todos los créditos de cobranza: filtros, búsqueda y orden.
// Función pura, sin base de datos, para poder probarla con `node --test`.

import { estaEnMora } from "./rules.ts";

export interface CreditListRow {
  creditId: string;
  clientId: string;
  cliente: string;
  numeroCliente: string;
  noCredito: string;
  tipoCredito: string | null;
  montoCredito: number | null;
  fechaMinistracion: string | null;
  /** false = salió del listado de SIAC (liquidado o dado de baja). */
  enListado: boolean;
  etapaManual: "juridico" | "reestructura" | "pausado" | "extrajudicial" | null;
  /** Montos de la última foto completa; null si el crédito no viene en ella. */
  adeudo: number | null;
  vencido: number | null;
  atraso: number | null;
  proximoVencimiento: string | null;
  montoSiguiente: number | null;
  vencimientos: number | null;
  cubiertos: number | null;
  vencidos: number | null;
  ultimoPago: string | null;
}

export type CreditFilter = "activos" | "mora" | "corriente" | "proximos" | "extrajudicial" | "juridico" | "fuera";
export type CreditOrder = "credito" | "cliente" | "vencido" | "adeudo" | "atraso" | "proximo";

export interface CreditListItem extends CreditListRow {
  enMora: boolean;
  /** Ya vencieron todas sus mensualidades: no hay próxima fecha, solo queda cobrar lo vencido. */
  plazoTerminado: boolean;
}

/** SIAC no trae próxima fecha cuando todas las mensualidades ya están pagadas o vencidas. */
export function plazoTerminado(r: Pick<CreditListRow, "proximoVencimiento" | "vencimientos" | "cubiertos" | "vencidos">): boolean {
  if (r.proximoVencimiento !== null || !r.vencimientos || r.cubiertos === null) return false;
  return r.cubiertos + (r.vencidos ?? 0) >= r.vencimientos;
}

export const FILTROS_CREDITO: { value: CreditFilter; label: string }[] = [
  { value: "activos", label: "Activos" },
  { value: "mora", label: "En mora" },
  { value: "corriente", label: "Al corriente" },
  { value: "proximos", label: "Pagan en 7 días" },
  { value: "extrajudicial", label: "Extrajudicial" },
  { value: "juridico", label: "Jurídico" },
  { value: "fuera", label: "Salieron de SIAC" },
];

/** Número de crédito y cliente de la A a la Z; montos y atraso, el mayor primero; el próximo pago, el más cercano primero. */
export const ORDENES_CREDITO: { value: CreditOrder; label: string }[] = [
  { value: "credito", label: "Número de crédito" },
  { value: "cliente", label: "Cliente (A–Z)" },
  { value: "vencido", label: "Mayor vencido" },
  { value: "adeudo", label: "Mayor adeudo" },
  { value: "atraso", label: "Más días de atraso" },
  { value: "proximo", label: "Próximo pago" },
];

const sinAcentos = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const porCredito = (a: CreditListRow, b: CreditListRow) => a.noCredito.localeCompare(b.noCredito, "es", { numeric: true, sensitivity: "base" });
const porCliente = (a: CreditListRow, b: CreditListRow) => a.cliente.localeCompare(b.cliente, "es", { sensitivity: "base" }) || porCredito(a, b);
const n = (v: number | null) => v ?? -1;

const COMPARAR: Record<CreditOrder, (a: CreditListItem, b: CreditListItem) => number> = {
  credito: porCredito,
  cliente: porCliente,
  vencido: (a, b) => n(b.vencido) - n(a.vencido) || n(b.adeudo) - n(a.adeudo) || porCredito(a, b),
  adeudo: (a, b) => n(b.adeudo) - n(a.adeudo) || porCredito(a, b),
  atraso: (a, b) => n(b.atraso) - n(a.atraso) || n(b.vencido) - n(a.vencido) || porCredito(a, b),
  // Sin fecha al final.
  proximo: (a, b) => (a.proximoVencimiento ?? "9999").localeCompare(b.proximoVencimiento ?? "9999") || porCredito(a, b),
};

/** Días entre dos fechas YYYY-MM-DD. */
const dias = (desde: string, hasta: string) => Math.round((Date.parse(hasta) - Date.parse(desde)) / 86_400_000);

export function buildCreditList(
  rows: CreditListRow[],
  umbral: number,
  hoy: string,
  opts: { filtro: CreditFilter; q: string; orden?: CreditOrder },
): { items: CreditListItem[]; conteos: Record<CreditFilter, number>; total: number } {
  const todos: CreditListItem[] = rows.map((r) => ({
    ...r,
    enMora: r.enListado && estaEnMora(r.vencido ?? 0, r.atraso ?? 0, umbral),
    plazoTerminado: r.enListado && plazoTerminado(r),
  }));

  const q = sinAcentos(opts.q.trim());
  const digitos = q.replace(/\D/g, "");
  const buscados = q
    ? todos.filter(
        (c) =>
          sinAcentos(c.cliente).includes(q) ||
          sinAcentos(c.noCredito).includes(q) ||
          (digitos !== "" && digitos.length === q.length && c.numeroCliente.includes(digitos)),
      )
    : todos;

  const pasa: Record<CreditFilter, (c: CreditListItem) => boolean> = {
    activos: (c) => c.enListado,
    mora: (c) => c.enMora,
    corriente: (c) => c.enListado && !c.enMora,
    proximos: (c) => c.enListado && !c.enMora && c.proximoVencimiento !== null && dias(hoy, c.proximoVencimiento) >= 0 && dias(hoy, c.proximoVencimiento) <= 7,
    extrajudicial: (c) => c.enListado && c.etapaManual === "extrajudicial",
    juridico: (c) => c.enListado && c.etapaManual === "juridico",
    fuera: (c) => !c.enListado,
  };
  const conteos = Object.fromEntries(FILTROS_CREDITO.map((f) => [f.value, buscados.filter(pasa[f.value]).length])) as Record<CreditFilter, number>;

  const items = buscados.filter(pasa[opts.filtro]).sort(COMPARAR[opts.orden ?? "credito"]);
  return { items, conteos, total: todos.filter((c) => c.enListado).length };
}
