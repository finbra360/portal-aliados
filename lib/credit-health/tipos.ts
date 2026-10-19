/**
 * Partes del diagnóstico guardado (result_snapshot / input_snapshot) que muestra el
 * backoffice. El contrato completo vive en finbra360/credit-health (src/lib/engine/types.ts).
 */

export interface MetricaCH {
  value: number | null;
  state: "ok" | "not_applicable" | "insufficient_data";
}

export interface ReglaCH {
  id: string;
  label: string;
  outcome: "pass" | "fail" | "unknown";
  action: "exclude" | "review" | "ignore";
  explanation: string;
}

export interface ResultadoCH {
  status: string;
  statusLabel: string;
  rules: ReglaCH[];
  exclusions: ReglaCH[];
  reviews: ReglaCH[];
  missing: { path: string; label: string }[];
  cashflow: { baseSales: MetricaCH; salesSource: string | null; fixedExpenses: MetricaCH; cfads: MetricaCH };
  currentDebtService: MetricaCH;
  dscrCurrent: MetricaCH;
  capacity: { bindingConstraint: string | null; flowCapacity: MetricaCH; collateralCapacity: MetricaCH };
  score: { total: number | null };
  engineVersion: string;
}

export interface EntradaCH {
  company: {
    legalForm: string | null;
    monthsOperating: number | null;
    annualRevenue: number | null;
    rfcActive: string | null;
    activityDescription: string | null;
  };
  finances: {
    costOfSales: number | null;
    taxesPaid: number | null;
    debtBalance: number | null;
    collectionDays: number | null;
    paymentDays: number | null;
    topClientSharePct: number | null;
  };
  financing: {
    purpose: string | null;
    collateralType: string | null;
    collateralValue: number | null;
    creditHistory: string | null;
  };
}
