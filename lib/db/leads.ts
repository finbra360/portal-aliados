import { sql, transaccion } from "@/lib/db";
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

/** Un lado del par que se está comparando. */
export interface LadoDedup {
  id: string;
  nombre: string;
  municipio: string | null;
  estado: string | null;
  telefono: string | null;
  correo: string | null;
  domain: string | null;
  totalScore: number | null;
}

export interface HitlReviewItem {
  id: number;
  companyId: string;
  companyNombre: string;
  companyCategoria: LeadCategoria | null;
  reason: string;
  status: "pendiente" | "resuelto";
  createdAt: string;
  /**
   * Las dos empresas del par, con lo necesario para decidir sin salir de la
   * pantalla. Antes aquí solo había un `reason` con un UUID crudo adentro, así
   * que para juzgar «¿son la misma?» había que irse a buscar la otra empresa a
   * mano. Nadie hace eso 93 veces.
   */
  lados: [LadoDedup, LadoDedup] | null;
}

function mapLado(r: Record<string, unknown>, p: string): LadoDedup {
  return {
    id: r[`${p}_id`] as string,
    nombre: r[`${p}_nombre`] as string,
    municipio: (r[`${p}_municipio`] as string) ?? null,
    estado: (r[`${p}_estado`] as string) ?? null,
    telefono: (r[`${p}_telefono`] as string) ?? null,
    correo: (r[`${p}_correo`] as string) ?? null,
    domain: (r[`${p}_domain`] as string) ?? null,
    totalScore: r[`${p}_score`] == null ? null : Number(r[`${p}_score`]),
  };
}

function mapHitlRow(r: Record<string, unknown>): HitlReviewItem {
  return {
    id: r.id as number,
    companyId: r.company_id as string,
    companyNombre: r.a_nombre as string,
    companyCategoria: (r.categoria as LeadCategoria) ?? null,
    reason: r.reason as string,
    status: r.status as "pendiente" | "resuelto",
    createdAt: (r.created_at as Date).toISOString(),
    lados: r.b_id ? [mapLado(r, "a"), mapLado(r, "b")] : null,
  };
}

export async function listPendingHitlReviews(): Promise<HitlReviewItem[]> {
  // La contraparte del par vive dentro del texto de `reason` porque la tabla
  // nunca tuvo columna para ella. Para listar, extraerla con regexp es
  // aceptable: si falla, la fila sale sin comparación y el revisor la ve
  // igual. Para fusionar no lo es, y ahí `resolverDedupHitl` aborta.
  const rows = await sql`
    SELECT h.id, h.company_id, h.reason, h.status, h.created_at, a.categoria,
           a.id AS a_id, a.nombre_comercial AS a_nombre, a.municipio AS a_municipio,
           a.estado AS a_estado, a.telefono_principal AS a_telefono,
           a.correo_corporativo AS a_correo, a.domain AS a_domain, a.total_score AS a_score,
           b.id AS b_id, b.nombre_comercial AS b_nombre, b.municipio AS b_municipio,
           b.estado AS b_estado, b.telefono_principal AS b_telefono,
           b.correo_corporativo AS b_correo, b.domain AS b_domain, b.total_score AS b_score
    FROM lead_hitl_review h
    JOIN lead_companies a ON a.id = h.company_id
    LEFT JOIN lead_companies b
      ON b.id = (substring(h.reason from 'duplicado de ([0-9a-f-]{36})'))::uuid
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

/**
 * Las revisiones de dedup son el 100% de la cola, y hasta ahora resolverlas no
 * hacía nada: `resolveHitlReview` marca la fila como resuelta y escribe el
 * audit log, pero no toca `lead_companies`. Alguien podía trabajar las 93
 * pendientes, escribir 93 notas, y los 93 duplicados seguían ahí como empresas
 * separadas. El trabajo humano no aterrizaba en ningún lado.
 *
 * Esto le da a la decisión dos salidas reales.
 */
export type DecisionDedup = "misma" | "distintas";

export interface ResultadoDedup {
  decision: DecisionDedup;
  sobreviveId: string;
  sobreviveNombre: string;
  descartadaId: string | null;
  descartadaNombre: string | null;
}

/**
 * La contraparte del par vive dentro del texto de `reason`, con la forma
 * «posible duplicado de <uuid> (score N)», porque la tabla nunca tuvo columna
 * para ella. Leerla de un texto libre es frágil para una operación que
 * descarta una empresa, así que esto falla ruidosamente en vez de adivinar: si
 * el uuid no se puede extraer, o no existe, o resulta ser la misma empresa, no
 * se fusiona nada. Lo correcto a futuro es una columna `related_company_id`.
 */
function extraerContraparte(reason: string): string | null {
  const m = reason.match(/duplicado de ([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
  return m ? m[1] : null;
}

export async function resolverDedupHitl(params: {
  id: number;
  decision: DecisionDedup;
  actorEmail: string;
  nota: string | null;
}): Promise<ResultadoDedup> {
  const resultado = await transaccion(async (tx) => {
    const review = await tx`
      SELECT id, company_id, reason FROM lead_hitl_review
      WHERE id = ${params.id} AND status = 'pendiente'
      FOR UPDATE
    `;
    if (!review[0]) {
      throw new Error("Revisión no encontrada o ya resuelta");
    }

    const companyId = review[0].company_id as string;
    const contraparteId = extraerContraparte(String(review[0].reason ?? ""));
    if (!contraparteId || contraparteId === companyId) {
      throw new Error("No se pudo identificar la empresa con la que se compara");
    }

    // El superviviente se elige con una regla fija para que la fusión sea
    // predecible y no dependa de quién la ejecutó: gana la que el pipeline ya
    // calificó más alto, y entre dos sin score, la más antigua, que es la que
    // trae historial de actividad colgando.
    const candidatas = await tx`
      SELECT id, nombre_comercial FROM lead_companies
      WHERE id IN (${companyId}, ${contraparteId})
      ORDER BY total_score DESC NULLS LAST, fecha_descubrimiento ASC
    `;
    if (candidatas.length !== 2) {
      throw new Error("Una de las dos empresas del par ya no existe");
    }
    const sobrevive = candidatas[0];
    const descartada = candidatas[1];

    if (params.decision === "distintas") {
      // No se fusiona nada, pero la decisión se deja escrita en las dos
      // empresas: sin eso, lo único que queda es una nota suelta en la fila de
      // revisión y nadie puede saber después que esto ya se miró.
      for (const empresa of [companyId, contraparteId]) {
        await tx`
          INSERT INTO lead_prospecting_activity (company_id, activity_type, actor, metadata)
          VALUES (
            ${empresa},
            'dedup_confirmado_distinto',
            ${params.actorEmail},
            jsonb_build_object('par_con', ${empresa === companyId ? contraparteId : companyId}::text, 'nota', ${params.nota}::text)
          )
        `;
      }
    } else {
      // Fusión: el superviviente se queda con los datos de contacto que le
      // faltaban. Es el punto de la fusión -- si una trae teléfono y la otra
      // correo, separadas valen menos que juntas.
      await tx`
        UPDATE lead_companies s SET
          telefono_principal = COALESCE(s.telefono_principal, d.telefono_principal),
          correo_corporativo = COALESCE(s.correo_corporativo, d.correo_corporativo),
          domain = COALESCE(s.domain, d.domain),
          website_url = COALESCE(s.website_url, d.website_url),
          razon_social = COALESCE(s.razon_social, d.razon_social),
          empleados_estimado = COALESCE(s.empleados_estimado, d.empleados_estimado),
          antiguedad_anios_estimado = COALESCE(s.antiguedad_anios_estimado, d.antiguedad_anios_estimado),
          ventas_estimado_mxn = COALESCE(s.ventas_estimado_mxn, d.ventas_estimado_mxn),
          unidades_flota_estimado = COALESCE(s.unidades_flota_estimado, d.unidades_flota_estimado),
          unidades_libres_gravamen = COALESCE(s.unidades_libres_gravamen, d.unidades_libres_gravamen),
          fecha_ultima_actualizacion = now()
        FROM lead_companies d
        WHERE s.id = ${sobrevive.id as string} AND d.id = ${descartada.id as string}
      `;

      // La duplicada no se borra. Su id puede estar colgado de actividad,
      // scores y fuentes, y borrarla partiría ese historial; además, si la
      // decisión estuvo mal, un registro descartado se recupera y uno borrado
      // no.
      await tx`
        UPDATE lead_companies SET
          categoria = 'discarded',
          estatus_comercial = 'descartado',
          discard_reason = ${"duplicado de " + (sobrevive.id as string)},
          fecha_ultima_actualizacion = now()
        WHERE id = ${descartada.id as string}
      `;

      await tx`
        INSERT INTO lead_prospecting_activity (company_id, activity_type, actor, metadata)
        VALUES (
          ${descartada.id as string},
          'fusionado_como_duplicado',
          ${params.actorEmail},
          jsonb_build_object('sobrevive', ${sobrevive.id as string}::text, 'nota', ${params.nota}::text)
        )
      `;
    }

    await tx`
      UPDATE lead_hitl_review SET
        status = 'resuelto',
        resolution_notes = ${(params.decision === "misma" ? "Fusionada" : "Confirmadas distintas") + (params.nota ? ": " + params.nota : "")},
        resolved_at = now()
      WHERE id = ${params.id}
    `;

    return {
      decision: params.decision,
      sobreviveId: sobrevive.id as string,
      sobreviveNombre: sobrevive.nombre_comercial as string,
      descartadaId: params.decision === "misma" ? (descartada.id as string) : null,
      descartadaNombre: params.decision === "misma" ? (descartada.nombre_comercial as string) : null,
    };
  });

  await logAudit({
    actorEmail: params.actorEmail,
    action: "resolver_dedup_hitl",
    entityType: "lead_hitl_review",
    entityId: String(params.id),
    metadata: { ...resultado, nota: params.nota },
  });

  return resultado;
}
