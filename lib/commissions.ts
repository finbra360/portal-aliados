import type { OperacionFondeada } from "./n8n";

/**
 * Tabla de comisión del broker según el % de comisión de apertura pactado
 * con el cliente. Confirmada por Finbra (Santiago) el 2026-09-02. Si en el
 * futuro se pactan otros % de apertura, agregar la fila correspondiente aquí.
 */
export const COMMISSION_TIERS: { aperturaPct: number; brokerPct: number }[] = [
  { aperturaPct: 5, brokerPct: 2 },
  { aperturaPct: 4.5, brokerPct: 1.5 },
  { aperturaPct: 4, brokerPct: 1.25 },
  { aperturaPct: 3.5, brokerPct: 1 },
];

/** Bono adicional al broker cuando el cliente termina de pagar el crédito. */
export const PAGADO_TOTALIDAD_BONUS_PCT = 1;

function getBrokerPct(aperturaPct: number | undefined): number | null {
  if (aperturaPct === undefined) return null;
  const tier = COMMISSION_TIERS.find((t) => t.aperturaPct === aperturaPct);
  return tier ? tier.brokerPct : null;
}

export interface CommissionLine {
  operacion: OperacionFondeada;
  /** null cuando la operación no tiene % de apertura capturado o no coincide con un tier conocido. */
  brokerPct: number | null;
  montoBase: number;
  montoBono: number;
  montoTotal: number;
}

export function calcCommissionLine(operacion: OperacionFondeada): CommissionLine {
  const brokerPct = getBrokerPct(operacion.comisionAperturaPct);
  const montoBase = brokerPct !== null ? (operacion.monto * brokerPct) / 100 : 0;
  const montoBono = operacion.pagadoTotalidad ? (operacion.monto * PAGADO_TOTALIDAD_BONUS_PCT) / 100 : 0;

  return {
    operacion,
    brokerPct,
    montoBase,
    montoBono,
    montoTotal: montoBase + montoBono,
  };
}

export interface CommissionSummary {
  lines: CommissionLine[];
  totalGenerado: number;
  totalPendienteDefinir: number;
  countPendienteDefinir: number;
}

export function summarizeCommissions(operaciones: OperacionFondeada[]): CommissionSummary {
  const lines = operaciones.map(calcCommissionLine);
  const totalGenerado = lines.reduce((sum, l) => sum + l.montoTotal, 0);
  const pendientes = lines.filter((l) => l.brokerPct === null);

  return {
    lines,
    totalGenerado,
    totalPendienteDefinir: pendientes.reduce((sum, l) => sum + l.operacion.monto, 0),
    countPendienteDefinir: pendientes.length,
  };
}
