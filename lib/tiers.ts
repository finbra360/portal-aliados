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
  { id: "bronce", nombre: "Bronce", umbral: 0, color: "#9c6b35" },
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

function luminancia(hex: string): number {
  const canal = (i: number) => {
    const c = parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * canal(0) + 0.7152 * canal(1) + 0.0722 * canal(2);
}

/** Relación de contraste WCAG entre dos colores "#rrggbb" (de 1 a 21; AA pide 4.5 para texto normal). */
export function contraste(a: string, b: string): number {
  const [claro, oscuro] = [luminancia(a), luminancia(b)].sort((x, y) => y - x);
  return (claro + 0.05) / (oscuro + 0.05);
}

/** Texto blanco u oscuro, el que mejor se lea sobre el fondo de la insignia del nivel. */
export function colorDeTexto(fondo: string): "#ffffff" | "#1a1a1a" {
  return contraste(fondo, "#ffffff") >= contraste(fondo, "#1a1a1a") ? "#ffffff" : "#1a1a1a";
}
