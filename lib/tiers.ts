export interface Tier {
  id: string;
  nombre: string;
  umbral: number;
  color: string;
}

/**
 * Umbrales propuestos, no un dato oficial de Finbra — ajustar cuando
 * el negocio defina las reglas reales de niveles de broker.
 */
export const TIERS: Tier[] = [
  { id: "bronce", nombre: "Bronce", umbral: 0, color: "#a8763e" },
  { id: "plata", nombre: "Plata", umbral: 1_000_000, color: "#9599a6" },
  { id: "oro", nombre: "Oro", umbral: 5_000_000, color: "#c9a227" },
  { id: "platino", nombre: "Platino", umbral: 15_000_000, color: "#5d5bdb" },
];

export interface TierProgress {
  actual: Tier;
  siguiente: Tier | null;
  progresoPct: number;
  faltante: number;
}

export function getTierProgress(totalHistorico: number): TierProgress {
  let actual = TIERS[0];
  for (const tier of TIERS) {
    if (totalHistorico >= tier.umbral) {
      actual = tier;
    }
  }

  const idx = TIERS.findIndex((t) => t.id === actual.id);
  const siguiente = idx < TIERS.length - 1 ? TIERS[idx + 1] : null;

  if (!siguiente) {
    return { actual, siguiente: null, progresoPct: 100, faltante: 0 };
  }

  const rango = siguiente.umbral - actual.umbral;
  const avance = totalHistorico - actual.umbral;
  const progresoPct = rango > 0 ? Math.min(100, Math.max(0, (avance / rango) * 100)) : 100;

  return {
    actual,
    siguiente,
    progresoPct,
    faltante: Math.max(0, siguiente.umbral - totalHistorico),
  };
}
