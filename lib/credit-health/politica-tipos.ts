/**
 * Forma de la política de Credit Health para el editor del backoffice. La validación
 * real la hace la API interna de finbra360/credit-health (esquema Zod del motor).
 */

export type AccionRegla = "exclude" | "review" | "ignore";

export const REGLAS = [
  ["industry_restricted", "Industria restringida"],
  ["legal_form_not_accepted", "Figura jurídica no aceptada"],
  ["rfc_inactive", "RFC inactivo"],
  ["rfc_unknown", "RFC desconocido"],
  ["min_months_operating", "Antigüedad mínima"],
  ["min_annual_revenue", "Ingresos anuales mínimos"],
  ["requested_below_min", "Monto menor al mínimo"],
  ["collateral_missing", "Sin garantía"],
  ["collateral_type_not_accepted", "Garantía no aceptada"],
  ["collateral_insufficient_for_min", "Garantía insuficiente para el mínimo"],
  ["mop_above_max", "MOP mayor al máximo"],
  ["no_payment_capacity", "Sin capacidad de pago"],
  ["amount_below_min_at_term", "Monto sostenible bajo el mínimo al plazo"],
  ["customer_concentration", "Concentración de clientes"],
  ["declared_sales_mismatch", "Ventas declaradas vs historial"],
  ["declared_revenue_mismatch", "Facturación anual vs ventas mensuales"],
] as const;

export interface IndustriaRestringida {
  code: string;
  label: string;
  reason: string;
  confirmed: boolean;
}

export interface PoliticaCH {
  label: string;
  product: { minAmount: number; maxAmount: number; minTermMonths: number; maxTermMonths: number; annualRate: number; vatOnInterest: boolean; vatRate: number };
  capacity: { minDscr: number; stressSalesDropPct: number; sensitivityDropsPct: number[]; operatingCashBufferMonths: number };
  eligibility: {
    minAnnualRevenue: number;
    minMonthsOperating: number;
    acceptedLegalForms: string[];
    collateralRequired: boolean;
    collateral: { vehicular: { accepted: boolean; coverageRatio: number }; inmobiliaria: { accepted: boolean; coverageRatio: number } };
    restrictedIndustries: IndustriaRestringida[];
    bureau: {
      maxMop: number;
      lookbackMonths: number;
      productsConsidered: string[];
      exceptions: string;
      unknownTreatment: AccionRegla;
      noHistoryTreatment: AccionRegla;
    };
    customerConcentrationReviewPct: number;
    declaredVsHistoryReviewPct: number;
  };
  rules: Record<string, AccionRegla>;
  scoring: { weights: { capacity: number; stability: number; leverage: number; liquidity: number; operations: number } };
  priority: { highPriorityMinAmount: number; highPriorityMinScore: number };
  retention: { leadRetentionDays: number; funnelEventRetentionDays: number };
  pendingApproval: string[];
}
