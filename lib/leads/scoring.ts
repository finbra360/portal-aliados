// WF8 — Lead Scoring. Calcula Fit (0-40) + Intent (0-35) + Data Quality
// (0-25) = Total (0-100) según los pesos definidos en la Etapa 4. El
// número siempre sale de aquí; la explicación en lenguaje natural (IA) solo
// rellena una plantilla fija con estos componentes, nunca los reemplaza.

import type { VerticalPackIcp } from "./qualification";

export interface FitInputs {
  empleadosEstimado: number | null;
  ventasEstimadoMxn: number | null;
  antiguedadAniosEstimado: number | null;
  cicloCobranzaDiasEstimado: number | null;
  clienteB2BoB2G: boolean | null;
  /** Proxy 0-1 de qué tan buena es la garantía (nº de unidades, tamaño de inmueble, etc.), calculado en Enrichment. */
  calidadGarantia: number;
  ticketEstimadoMxn: number | null;
  icp: VerticalPackIcp;
}

export function calculateFitScore(inputs: FitInputs): number {
  let score = 0;

  if (inputs.ventasEstimadoMxn != null) {
    const [sweetLo, sweetHi] = inputs.icp.ventas_mxn_sweet_spot;
    if (inputs.ventasEstimadoMxn >= sweetLo && inputs.ventasEstimadoMxn <= sweetHi) {
      score += 10;
    } else if (
      inputs.ventasEstimadoMxn >= inputs.icp.ventas_mxn_min &&
      inputs.ventasEstimadoMxn <= inputs.icp.ventas_mxn_max
    ) {
      score += 6;
    }
  }

  score += Math.round(clamp01(inputs.calidadGarantia) * 12);

  if (inputs.antiguedadAniosEstimado != null) {
    const capped = Math.min(inputs.antiguedadAniosEstimado, 8);
    score += Math.round((capped / 8) * 6);
  }

  if (inputs.cicloCobranzaDiasEstimado != null) {
    const d = inputs.cicloCobranzaDiasEstimado;
    if (d >= 30 && d <= 90) score += 6;
    else if (d > 90 && d <= 150) score += 4;
    else if (d > 150) score += 1; // ciclo extremo huele a riesgo de cobro, no a mejor fit
    else score += 2; // <30 dias: cobro rapido, necesidad de capital de trabajo mas debil
  }

  if (inputs.clienteB2BoB2G) score += 3;

  if (inputs.ticketEstimadoMxn != null) {
    score += inputs.ticketEstimadoMxn >= 500_000 && inputs.ticketEstimadoMxn <= 5_000_000 ? 3 : 1;
  }

  return Math.min(score, 40);
}

export interface IntentSignal {
  signalType: string;
}

type IntentCategoria = "crecimiento" | "evento_activo" | "especifica_vertical";

// Config por defecto -- un vertical_pack puede sobreescribir vía scoring_overrides.
const INTENT_SIGNAL_WEIGHTS: Record<string, { categoria: IntentCategoria; puntos: number }> = {
  expansion_flota: { categoria: "crecimiento", puntos: 6 },
  nueva_sucursal: { categoria: "crecimiento", puntos: 5 },
  contratacion_activa: { categoria: "crecimiento", puntos: 4 },
  nuevo_contrato: { categoria: "crecimiento", puntos: 6 },
  nueva_ruta: { categoria: "crecimiento", puntos: 4 },
  compra_activo_reciente: { categoria: "evento_activo", puntos: 8 },
  reparacion_o_mantenimiento_mayor: { categoria: "evento_activo", puntos: 5 },
  proyecto_pendiente_cobro: { categoria: "especifica_vertical", puntos: 7 },
};

const INTENT_CATEGORY_CAPS: Record<IntentCategoria, number> = {
  crecimiento: 15,
  evento_activo: 10,
  especifica_vertical: 10,
};

export function calculateIntentScore(
  signals: IntentSignal[],
  weightOverrides: Partial<typeof INTENT_SIGNAL_WEIGHTS> = {},
): number {
  const weights = { ...INTENT_SIGNAL_WEIGHTS, ...weightOverrides };
  const totals: Record<IntentCategoria, number> = { crecimiento: 0, evento_activo: 0, especifica_vertical: 0 };

  for (const signal of signals) {
    const weight = weights[signal.signalType];
    if (!weight) continue; // señal no mapeada en el vertical pack -> no puntúa, no truena
    totals[weight.categoria] += weight.puntos;
  }

  return (Object.keys(INTENT_CATEGORY_CAPS) as IntentCategoria[]).reduce(
    (score, cat) => score + Math.min(totals[cat], INTENT_CATEGORY_CAPS[cat]),
    0,
  );
}

export interface DataQualityInputs {
  camposObligatorios: Array<{ campo: string; presente: boolean }>;
  /** Confianza promedio ponderada de las fuentes usadas, 0-1. */
  confidencePromedioFuentes: number;
  contradiccionesDetectadas: number;
}

export function calculateDataQualityScore(inputs: DataQualityInputs): number {
  const completitud =
    inputs.camposObligatorios.length === 0
      ? 0
      : inputs.camposObligatorios.filter((c) => c.presente).length / inputs.camposObligatorios.length;

  let score = completitud * 10;
  score += clamp01(inputs.confidencePromedioFuentes) * 10;
  score += Math.max(0, 5 - inputs.contradiccionesDetectadas * 2.5);

  return Math.min(Math.round(score), 25);
}

export type LeadCategoria = "hot" | "warm" | "qualified" | "discarded";

export function categorizeLead(fitScore: number, intentScore: number, dataQualityScore: number): LeadCategoria {
  const total = fitScore + intentScore + dataQualityScore;
  // Piso de Fit y Data Quality en Hot: evita que alto Intent con garantia
  // dudosa o datos pobres se presente como "top priority" sin validar.
  if (total >= 75 && fitScore >= 28 && dataQualityScore >= 15) return "hot";
  if (total >= 55) return "warm";
  if (total >= 35) return "qualified";
  return "discarded";
}

export interface LeadScoreResult {
  fitScore: number;
  intentScore: number;
  dataQualityScore: number;
  totalScore: number;
  categoria: LeadCategoria;
}

export function scoreLead(
  fitInputs: FitInputs,
  intentSignals: IntentSignal[],
  dataQualityInputs: DataQualityInputs,
): LeadScoreResult {
  const fitScore = calculateFitScore(fitInputs);
  const intentScore = calculateIntentScore(intentSignals);
  const dataQualityScore = calculateDataQualityScore(dataQualityInputs);

  return {
    fitScore,
    intentScore,
    dataQualityScore,
    totalScore: fitScore + intentScore + dataQualityScore,
    categoria: categorizeLead(fitScore, intentScore, dataQualityScore),
  };
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}
