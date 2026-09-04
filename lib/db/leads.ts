import { sql } from "@/lib/db";
import { logAudit } from "./audit";

// contacto_directo: pasó los hard gates con datos del directorio público pero no
// tiene sitio web que enriquecer. No se gradúa contra hot/warm/qualified porque
// sin ventas, ciclo de cobranza ni señales su score no da para rankear; se
// trabaja como lista de correo o teléfono.
export type LeadCategoria = "hot" | "warm" | "qualified" | "discarded" | "contacto_directo";

export type LeadEstatusComercial =
  | "nuevo"
  | "en_revision_hitl"
  | "contactado"
  | "reunion_agendada"
  | "oportunidad"
  | "rechazado"
  | "cliente"
  | "descartado";

export interface LeadCompany {
  id: string;
  nombreComercial: string;
  razonSocial: string | null;
  municipio: string | null;
  estado: string | null;
  verticalPackId: string | null;
  domain: string | null;
  websiteUrl: string | null;
  telefonoPrincipal: string | null;
  correoCorporativo: string | null;
  empleadosEstimado: number | null;
  antiguedadAniosEstimado: number | null;
  tieneGarantiaVehicular: boolean;
  tieneGarantiaInmobiliaria: boolean;
  garantiaConfidence: number | null;
  garantiaVerificado: boolean;
  fitScore: number | null;
  intentScore: number | null;
  dataQualityScore: number | null;
  totalScore: number | null;
  categoria: LeadCategoria | null;
  scoreExplicacion: string | null;
  estatusComercial: LeadEstatusComercial;
  discardReason: string | null;
  fechaDescubrimiento: string;
  fechaUltimaActualizacion: string;
}

function mapCompanyRow(r: Record<string, unknown>): LeadCompany {
  return {
    id: r.id as string,
    nombreComercial: r.nombre_comercial as string,
    razonSocial: (r.razon_social as string) ?? null,
    municipio: (r.municipio as string) ?? null,
    estado: (r.estado as string) ?? null,
    verticalPackId: (r.vertical_pack_id as string) ?? null,
    domain: (r.domain as string) ?? null,
    websiteUrl: (r.website_url as string) ?? null,
    telefonoPrincipal: (r.telefono_principal as string) ?? null,
    correoCorporativo: (r.correo_corporativo as string) ?? null,
    empleadosEstimado: r.empleados_estimado != null ? Number(r.empleados_estimado) : null,
    antiguedadAniosEstimado: r.antiguedad_anios_estimado != null ? Number(r.antiguedad_anios_estimado) : null,
    tieneGarantiaVehicular: Boolean(r.tiene_garantia_vehicular),
    tieneGarantiaInmobiliaria: Boolean(r.tiene_garantia_inmobiliaria),
    garantiaConfidence: r.garantia_confidence != null ? Number(r.garantia_confidence) : null,
    garantiaVerificado: Boolean(r.garantia_verificado),
    fitScore: r.fit_score != null ? Number(r.fit_score) : null,
    intentScore: r.intent_score != null ? Number(r.intent_score) : null,
    dataQualityScore: r.data_quality_score != null ? Number(r.data_quality_score) : null,
    totalScore: r.total_score != null ? Number(r.total_score) : null,
    categoria: (r.categoria as LeadCategoria) ?? null,
    scoreExplicacion: (r.score_explicacion as string) ?? null,
    estatusComercial: r.estatus_comercial as LeadEstatusComercial,
    discardReason: (r.discard_reason as string) ?? null,
    fechaDescubrimiento: (r.fecha_descubrimiento as Date).toISOString(),
    fechaUltimaActualizacion: (r.fecha_ultima_actualizacion as Date).toISOString(),
  };
}

export interface LeadCompanyFilters {
  categoria?: string;
  estatusComercial?: string;
}

export const LEAD_PAGE_SIZES = [25, 50, 100] as const;
export type LeadPageSize = (typeof LEAD_PAGE_SIZES)[number];
export const DEFAULT_LEAD_PAGE_SIZE: LeadPageSize = 25;

export interface LeadCompanyPage {
  items: LeadCompany[];
  total: number;
}

export async function listLeadCompanies(
  filters: LeadCompanyFilters = {},
  pagination: { page: number; perPage: LeadPageSize } = { page: 1, perPage: DEFAULT_LEAD_PAGE_SIZE },
): Promise<LeadCompanyPage> {
  const offset = (pagination.page - 1) * pagination.perPage;

  const [rows, countRows] = await Promise.all([
    sql`
      SELECT * FROM lead_companies
      WHERE (${filters.categoria ?? null}::text IS NULL OR categoria = ${filters.categoria ?? null})
        AND (${filters.estatusComercial ?? null}::text IS NULL OR estatus_comercial = ${filters.estatusComercial ?? null})
      ORDER BY total_score DESC NULLS LAST, fecha_descubrimiento DESC
      LIMIT ${pagination.perPage} OFFSET ${offset}
    `,
    sql`
      SELECT COUNT(*)::int AS count FROM lead_companies
      WHERE (${filters.categoria ?? null}::text IS NULL OR categoria = ${filters.categoria ?? null})
        AND (${filters.estatusComercial ?? null}::text IS NULL OR estatus_comercial = ${filters.estatusComercial ?? null})
    `,
  ]);

  return { items: rows.map(mapCompanyRow), total: countRows[0].count as number };
}

export async function countLeadsByCategoria(): Promise<Record<string, number>> {
  const rows = await sql`
    SELECT COALESCE(categoria, 'sin_calificar') AS categoria, COUNT(*)::int AS count
    FROM lead_companies
    GROUP BY COALESCE(categoria, 'sin_calificar')
  `;
  const base: Record<string, number> = {
    hot: 0,
    warm: 0,
    qualified: 0,
    contacto_directo: 0,
    discarded: 0,
    sin_calificar: 0,
  };
  for (const r of rows) {
    base[r.categoria as string] = r.count as number;
  }
  return base;
}

export async function updateLeadEstatusComercial(params: {
  id: string;
  estatus: LeadEstatusComercial;
  actorEmail: string;
}): Promise<void> {
  const rows = await sql`
    UPDATE lead_companies SET estatus_comercial = ${params.estatus}, fecha_ultima_actualizacion = now()
    WHERE id = ${params.id}
    RETURNING id
  `;
  if (!rows[0]) {
    throw new Error("Lead no encontrado");
  }
  await sql`
    INSERT INTO lead_prospecting_activity (company_id, activity_type, actor)
    VALUES (${params.id}, ${params.estatus}, ${params.actorEmail})
  `;
  await logAudit({
    actorEmail: params.actorEmail,
    action: "update_lead_estatus_comercial",
    entityType: "lead_company",
    entityId: params.id,
    metadata: { estatus: params.estatus },
  });
}

export interface HitlReviewItem {
  id: number;
  companyId: string;
  companyNombre: string;
  companyCategoria: LeadCategoria | null;
  reason: string;
  status: "pendiente" | "resuelto";
  createdAt: string;
}

function mapHitlRow(r: Record<string, unknown>): HitlReviewItem {
  return {
    id: r.id as number,
    companyId: r.company_id as string,
    companyNombre: r.nombre_comercial as string,
    companyCategoria: (r.categoria as LeadCategoria) ?? null,
    reason: r.reason as string,
    status: r.status as "pendiente" | "resuelto",
    createdAt: (r.created_at as Date).toISOString(),
  };
}

export async function listPendingHitlReviews(): Promise<HitlReviewItem[]> {
  const rows = await sql`
    SELECT h.id, h.company_id, c.nombre_comercial, c.categoria, h.reason, h.status, h.created_at
    FROM lead_hitl_review h
    JOIN lead_companies c ON c.id = h.company_id
    WHERE h.status = 'pendiente'
    ORDER BY h.created_at ASC
    LIMIT 100
  `;
  return rows.map(mapHitlRow);
}

export async function resolveHitlReview(params: {
  id: number;
  resolutionNotes: string;
  actorEmail: string;
}): Promise<void> {
  const rows = await sql`
    UPDATE lead_hitl_review SET status = 'resuelto', resolution_notes = ${params.resolutionNotes}, resolved_at = now()
    WHERE id = ${params.id} AND status = 'pendiente'
    RETURNING company_id
  `;
  if (!rows[0]) {
    throw new Error("Revisión no encontrada o ya resuelta");
  }
  await logAudit({
    actorEmail: params.actorEmail,
    action: "resolve_hitl_review",
    entityType: "lead_hitl_review",
    entityId: String(params.id),
    metadata: { resolutionNotes: params.resolutionNotes, companyId: rows[0].company_id },
  });
}
