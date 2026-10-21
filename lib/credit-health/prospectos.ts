import type postgres from "postgres";
import type { AdminSessionPayload } from "../admin-auth";
import { PAGINA_CH, type FiltrosProspectos } from "./filtros";
import { descifrar, llaveCreditHealth } from "./cifrado";
import { chSql, chTransaccion } from "./db";
import type { Clasificacion, EstadoContacto } from "./catalogo";
import type { EntradaCH, ResultadoCH } from "./tipos";

const n = (v: unknown) => (v === null || v === undefined ? null : Number(v));

export interface ProspectoFila {
  id: string;
  folio: string;
  createdAt: Date;
  /** null mientras no termine el diagnóstico (solo dejó sus datos al iniciar). */
  tradeName: string | null;
  sectorCode: string | null;
  state: string | null;
  requestedAmount: number | null;
  termMonths: number | null;
  preliminaryAmount: number | null;
  maxPayment: number | null;
  dscrProjected: number | null;
  score: number | null;
  eligibilityStatus: string;
  classification: Clasificacion;
  contactStatus: EstadoContacto;
  intent: string;
  assignedTo: string | null;
  exclusionReasons: string[];
  isDemo: boolean;
  source: string | null;
}

function mapFila(r: Record<string, unknown>): ProspectoFila {
  return {
    id: r.id as string,
    folio: r.folio as string,
    createdAt: r.created_at as Date,
    tradeName: r.trade_name as string | null,
    sectorCode: r.sector_code as string | null,
    state: r.state as string | null,
    requestedAmount: n(r.requested_amount),
    termMonths: n(r.term_months),
    preliminaryAmount: n(r.preliminary_amount),
    maxPayment: n(r.max_payment),
    dscrProjected: n(r.dscr_projected),
    score: n(r.score),
    eligibilityStatus: r.eligibility_status as string,
    classification: r.classification as Clasificacion,
    contactStatus: r.contact_status as EstadoContacto,
    intent: r.intent as string,
    assignedTo: r.assigned_to as string | null,
    exclusionReasons: (r.exclusion_reasons as string[]) ?? [],
    isDemo: r.is_demo as boolean,
    source: r.source as string | null,
  };
}

function where(sql: postgres.Sql, f: Partial<FiltrosProspectos>) {
  const term = f.q ? `%${f.q.replace(/[%_\\]/g, (c) => `\\${c}`)}%` : null;
  return sql`
    where true
    ${f.incluirDemo ? sql`` : sql`and not is_demo`}
    ${f.clasificacion ? sql`and classification = ${f.clasificacion}` : sql``}
    ${f.contacto ? sql`and contact_status = ${f.contacto}` : sql``}
    ${f.sector ? sql`and sector_code = ${f.sector}` : sql``}
    ${f.montoMin !== undefined ? sql`and requested_amount >= ${f.montoMin}` : sql``}
    ${f.montoMax !== undefined ? sql`and requested_amount <= ${f.montoMax}` : sql``}
    ${f.pagoMin !== undefined ? sql`and max_payment >= ${f.pagoMin}` : sql``}
    ${term ? sql`and (trade_name ilike ${term} or folio ilike ${term})` : sql``}
  `;
}

const COLUMNAS_LISTA = `id, folio, created_at, trade_name, sector_code, state, requested_amount, term_months,
  preliminary_amount, max_payment, dscr_projected, score, eligibility_status, classification,
  contact_status, intent, assigned_to, exclusion_reasons, is_demo, source`;

/** Listado SIN datos personales. */
export async function listarProspectos(f: FiltrosProspectos, limite = PAGINA_CH) {
  const sql = chSql();
  const orden =
    f.orden === "monto"
      ? sql`requested_amount desc nulls last`
      : f.orden === "score"
        ? sql`score desc nulls last`
        : f.orden === "capacidad"
          ? sql`max_payment desc nulls last`
          : sql`created_at desc`;
  const [filas, [{ total }]] = await Promise.all([
    sql`select ${sql.unsafe(COLUMNAS_LISTA)} from leads ${where(sql, f)} order by ${orden}, folio limit ${limite} offset ${(f.pagina - 1) * limite}`,
    sql`select count(*)::int as total from leads ${where(sql, f)}`,
  ]);
  return { filas: filas.map(mapFila), total: total as number };
}

/** Para la exportación: todas las columnas, hasta 5,000 filas. */
export async function prospectosParaExportar(f: FiltrosProspectos) {
  const sql = chSql();
  return sql`select * from leads ${where(sql, f)} order by created_at desc limit 5000`;
}

export interface ProspectoDetalle extends ProspectoFila {
  legalForm: string | null;
  purpose: string | null;
  collateralType: string | null;
  cfads: number | null;
  contactRole: string | null;
  preferredContactTime: string | null;
  retentionUntil: Date;
  policyVersion: number | null;
  policyLabel: string | null;
  engineVersion: string | null;
  /** null mientras no termine el diagnóstico. */
  entrada: EntradaCH | null;
  resultado: ResultadoCH | null;
  cifrado: { nombre: string; correo: string; telefono: string; rfc: string | null };
}

export async function obtenerProspecto(id: string) {
  const sql = chSql();
  const [r] = await sql`
    select l.*, p.version as policy_version, p.label as policy_label
    from leads l left join policy_versions p on p.id = l.policy_version_id
    where l.id = ${id}`;
  if (!r) return null;
  const [eventos, consentimientos] = await Promise.all([
    sql`select id, type, from_value, to_value, note, actor, created_at from lead_events where lead_id = ${id} order by created_at desc, id desc`,
    sql`select id, type, granted, text_version, created_at from consents where lead_id = ${id} order by id`,
  ]);
  const detalle: ProspectoDetalle = {
    ...mapFila(r),
    legalForm: r.legal_form,
    purpose: r.purpose,
    collateralType: r.collateral_type,
    cfads: n(r.cfads),
    contactRole: r.contact_role,
    preferredContactTime: r.preferred_contact_time,
    retentionUntil: r.retention_until,
    policyVersion: n(r.policy_version),
    policyLabel: r.policy_label,
    engineVersion: r.engine_version,
    entrada: (r.input_snapshot as EntradaCH | null) ?? null,
    resultado: (r.result_snapshot as ResultadoCH | null) ?? null,
    cifrado: { nombre: r.contact_name_enc, correo: r.contact_email_enc, telefono: r.contact_phone_enc, rfc: r.rfc_enc },
  };
  return {
    prospecto: detalle,
    eventos: eventos.map((e) => ({
      id: e.id as number,
      tipo: e.type as string,
      de: e.from_value as string | null,
      a: e.to_value as string | null,
      nota: e.note as string | null,
      actor: e.actor as string,
      fecha: e.created_at as Date,
    })),
    consentimientos: consentimientos.map((c) => ({
      id: c.id as number,
      tipo: c.type as string,
      otorgado: c.granted as boolean,
      version: c.text_version as string,
      fecha: c.created_at as Date,
    })),
  };
}

/** Registro de auditoría en la base de Credit Health (sin datos personales). */
async function auditar(
  sql: postgres.Sql,
  admin: AdminSessionPayload,
  accion: string,
  entityId: string | null,
  metadata: Record<string, unknown> | null = null,
) {
  await sql`
    insert into audit_log (actor, actor_role, action, entity, entity_id, metadata)
    values (${admin.email}, ${admin.role}, ${accion}, 'lead', ${entityId}, ${metadata ? JSON.stringify(metadata) : null}::text::jsonb)`;
}

/** Descifra el contacto. El llamador ya verificó el permiso; la consulta queda auditada. */
export async function revelarContacto(p: ProspectoDetalle, admin: AdminSessionPayload) {
  const llave = llaveCreditHealth();
  await auditar(chSql(), admin, "lead.contact_viewed", p.id, { via: "backoffice" });
  return {
    nombre: descifrar(p.cifrado.nombre, llave),
    correo: descifrar(p.cifrado.correo, llave),
    telefono: descifrar(p.cifrado.telefono, llave),
    rfc: p.cifrado.rfc ? descifrar(p.cifrado.rfc, llave) : null,
  };
}

export async function cambiarEstadoContacto(id: string, estado: EstadoContacto, nota: string | null, admin: AdminSessionPayload) {
  await chTransaccion(async (tx) => {
    const [actual] = await tx`select contact_status from leads where id = ${id} for update`;
    if (!actual) throw new Error("Prospecto no encontrado");
    if (actual.contact_status === estado && !nota) return;
    await tx`update leads set contact_status = ${estado}, updated_at = now() where id = ${id}`;
    await tx`insert into lead_events (lead_id, type, from_value, to_value, note, actor)
             values (${id}, 'status_changed', ${actual.contact_status}, ${estado}, ${nota}, ${admin.email})`;
    await auditar(tx, admin, "lead.status_changed", id, { de: actual.contact_status, a: estado });
  });
}

export async function asignarProspecto(id: string, asignado: string | null, admin: AdminSessionPayload) {
  await chTransaccion(async (tx) => {
    const [actual] = await tx`select assigned_to from leads where id = ${id} for update`;
    if (!actual) throw new Error("Prospecto no encontrado");
    await tx`update leads set assigned_to = ${asignado}, updated_at = now() where id = ${id}`;
    await tx`insert into lead_events (lead_id, type, from_value, to_value, actor)
             values (${id}, 'assigned', ${actual.assigned_to}, ${asignado}, ${admin.email})`;
    await auditar(tx, admin, "lead.assigned", id);
  });
}

export async function agregarNota(id: string, nota: string, admin: AdminSessionPayload) {
  await chTransaccion(async (tx) => {
    await tx`insert into lead_events (lead_id, type, note, actor) values (${id}, 'note', ${nota}, ${admin.email})`;
    await tx`update leads set updated_at = now() where id = ${id}`;
    await auditar(tx, admin, "lead.note_added", id);
  });
}

/** Eliminación definitiva (derecho de cancelación). Borra consentimientos e historial en cascada. */
export async function eliminarProspecto(id: string, motivo: string, admin: AdminSessionPayload) {
  return chTransaccion(async (tx) => {
    const [fila] = await tx`delete from leads where id = ${id} returning folio`;
    if (fila) await auditar(tx, admin, "lead.deleted", id, { folio: fila.folio, motivo });
    return !!fila;
  });
}

export async function auditarExportacion(admin: AdminSessionPayload, conContacto: boolean, total: number) {
  await auditar(chSql(), admin, conContacto ? "leads.exported_with_contact" : "leads.exported", null, { total });
}

// ---------------------------------------------------------------------------
// Resumen
// ---------------------------------------------------------------------------

export async function resumenCreditHealth(dias: number, incluirDemo: boolean) {
  const sql = chSql();
  const desde = sql`now() - make_interval(days => ${dias})`;
  const demo = incluirDemo ? sql`` : sql`and not is_demo`;
  const [embudo, porClase, porSector, [contactos], prioridad] = await Promise.all([
    sql`select event, count(distinct anon_id)::int as n from funnel_events where created_at >= ${desde} group by event`,
    sql`select classification, count(*)::int as n, coalesce(sum(preliminary_amount), 0)::float8 as monto
        from leads where created_at >= ${desde} ${demo} group by classification`,
    sql`select sector_code, count(*)::int as n from leads where created_at >= ${desde} ${demo} group by sector_code order by n desc`,
    sql`select count(*)::int as total,
               count(*) filter (where contact_status <> 'nuevo')::int as contactados,
               count(*) filter (where contact_status = 'convertido')::int as convertidos
        from leads where created_at >= ${desde} ${demo}`,
    sql`select ${sql.unsafe(COLUMNAS_LISTA)} from leads
        where classification = 'alta_prioridad' and contact_status = 'nuevo' ${demo}
        order by created_at desc limit 6`,
  ]);
  const ev = (e: string) => (embudo.find((r) => r.event === e)?.n as number) ?? 0;
  return {
    embudo: {
      iniciados: ev("wizard_started"),
      completados: ev("diagnostic_completed"),
      pdf: ev("pdf_downloaded"),
      prospectos: contactos.total as number,
      contactados: contactos.contactados as number,
      convertidos: contactos.convertidos as number,
    },
    porClase: porClase.map((r) => ({ clasificacion: r.classification as Clasificacion, n: r.n as number, monto: r.monto as number })),
    porSector: porSector.map((r) => ({ sector: r.sector_code as string | null, n: r.n as number })),
    prioridad: prioridad.map(mapFila),
  };
}
