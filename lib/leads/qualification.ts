// WF6 — ICP Matching / Qualification. Hard gates: si cualquiera falla, la
// empresa se descarta antes de llegar a Lead Scoring (Etapa 4/6 del diseño).

export interface VerticalPackIcp {
  empleados_min: number;
  empleados_max: number;
  ventas_mxn_min: number;
  ventas_mxn_max: number;
  ventas_mxn_sweet_spot: [number, number];
  antiguedad_anios_min: number;
  ciclo_cobranza_dias_min?: number;
  requiere_garantia: boolean;
  tipos_garantia_aceptados: Array<"vehicular" | "inmobiliaria">;
}

export interface CompanyForQualification {
  empleadosEstimado: number | null;
  ventasEstimadoMxn: number | null;
  antiguedadAniosEstimado: number | null;
  tieneGarantiaVehicular: boolean;
  tieneGarantiaInmobiliaria: boolean;
  giroExcluido: boolean;
  litigioConocido: boolean;
}

export type FailedCriterio =
  | "antiguedad_minima"
  | "tamano_fuera_de_rango"
  | "sin_garantia_elegible"
  | "giro_excluido"
  | "litigio_o_fraude_conocido";

export interface QualificationResult {
  qualifies: boolean;
  failedCriteria: FailedCriterio[];
}

export function checkHardGates(
  company: CompanyForQualification,
  icp: VerticalPackIcp,
): QualificationResult {
  const failed: FailedCriterio[] = [];

  if (company.antiguedadAniosEstimado == null || company.antiguedadAniosEstimado < icp.antiguedad_anios_min) {
    failed.push("antiguedad_minima");
  }

  if (
    company.empleadosEstimado == null ||
    company.empleadosEstimado < icp.empleados_min ||
    company.empleadosEstimado > icp.empleados_max
  ) {
    failed.push("tamano_fuera_de_rango");
  }

  if (icp.requiere_garantia) {
    const tieneGarantiaValida =
      (icp.tipos_garantia_aceptados.includes("vehicular") && company.tieneGarantiaVehicular) ||
      (icp.tipos_garantia_aceptados.includes("inmobiliaria") && company.tieneGarantiaInmobiliaria);
    if (!tieneGarantiaValida) failed.push("sin_garantia_elegible");
  }

  if (company.giroExcluido) failed.push("giro_excluido");
  if (company.litigioConocido) failed.push("litigio_o_fraude_conocido");

  return { qualifies: failed.length === 0, failedCriteria: failed };
}
