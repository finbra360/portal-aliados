import type { PorMes } from "./n8n";

/**
 * Cuenta meses consecutivos (contando desde el más reciente hacia atrás)
 * con colocación > 0. Depende de que `porMes` venga ordenado cronológicamente
 * y sin huecos entre meses consecutivos con datos (si un mes no tiene
 * colocación simplemente no aparece en el arreglo, así que un hueco también
 * corta la racha).
 */
export function getCurrentStreak(porMes: PorMes[]): number {
  if (!porMes.length) return 0;

  let streak = 0;
  for (let i = porMes.length - 1; i >= 0; i -= 1) {
    if (porMes[i].monto > 0) {
      streak += 1;
    } else {
      break;
    }
  }
  return streak;
}

export function getPeriodDelta(current: number, previous: number): number | null {
  if (previous <= 0) return null;
  return ((current - previous) / previous) * 100;
}
