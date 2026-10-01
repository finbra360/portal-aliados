export function formatCurrency(value: number): string {
  return new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: "MXN",
    maximumFractionDigits: 0,
  }).format(value);
}

export function formatCompactCurrency(value: number): string {
  return new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: "MXN",
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

export function formatPercent(value: number): string {
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(0)}%`;
}

/** Monto con centavos, para cobranza (los montos de SIAC se muestran a 2 decimales). */
export function formatMoney(value: number): string {
  return new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: "MXN",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

/** Proporción 0..1 como porcentaje con un decimal, o "—" si no aplica. */
export function formatRatio(value: number | null): string {
  return value === null ? "—" : `${(value * 100).toFixed(1)}%`;
}

/** "2026-09-30" → "30 sep 2026". Sin zona horaria: la fecha ya viene en hora de CDMX. */
export function formatFecha(iso: string | null): string {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-").map(Number);
  const meses = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
  return `${d} ${meses[m - 1]} ${y}`;
}

/** "5511112222" o "525511112222" → "+52 55 1111 2222"; cualquier otra cosa se deja como viene. */
export function formatTelefono(raw: string | null): string {
  if (!raw) return "";
  let d = raw.replace(/\D/g, "");
  if (d.length === 12 && d.startsWith("52")) d = d.slice(2);
  if (d.length === 10) return `+52 ${d.slice(0, 2)} ${d.slice(2, 6)} ${d.slice(6)}`;
  return raw;
}

/** Fecha y hora en CDMX: "1 oct 2026, 14:05". */
export function formatFechaHora(isoDate: string): string {
  return new Intl.DateTimeFormat("es-MX", {
    timeZone: "America/Mexico_City",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(isoDate));
}
