import type { PorMes } from "./n8n";

export type ChartPeriod = "mes" | "trimestre" | "anio";

export interface ChartPoint {
  label: string;
  monto: number;
}

const MONTH_LABELS = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];

function monthIndex(mes: string): number {
  const idx = MONTH_LABELS.indexOf(mes);
  return idx >= 0 ? idx : 0;
}

/**
 * Aggregates the real monthly series returned by the stats webhook into a
 * quarterly or yearly view. All data comes from `porMes` — nothing invented.
 */
export function aggregatePorMes(porMes: PorMes[], period: ChartPeriod): ChartPoint[] {
  if (period === "mes") {
    const multiYear = new Set(porMes.map((p) => p.anio)).size > 1;
    return porMes.map((p) => ({
      label: multiYear ? `${p.mes} ${String(p.anio).slice(2)}` : p.mes,
      monto: p.monto,
    }));
  }

  if (period === "trimestre") {
    const map = new Map<string, number>();
    for (const p of porMes) {
      const quarter = Math.floor(monthIndex(p.mes) / 3) + 1;
      const key = `T${quarter} ${p.anio}`;
      map.set(key, (map.get(key) ?? 0) + p.monto);
    }
    return Array.from(map.entries()).map(([label, monto]) => ({ label, monto }));
  }

  const map = new Map<number, number>();
  for (const p of porMes) {
    map.set(p.anio, (map.get(p.anio) ?? 0) + p.monto);
  }
  return Array.from(map.entries()).map(([anio, monto]) => ({ label: String(anio), monto }));
}
