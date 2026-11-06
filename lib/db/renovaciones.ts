// Radar de renovación y oportunidades (crm_oportunidades). Las reglas están en
// lib/clientes/renovaciones.ts; aquí se leen los datos y se aplican las acciones.
// Las cifras salen de la foto de SIAC; nada de aquí escribe en tablas col_*.

import { sql, transaccion } from "@/lib/db";
import { logAudit } from "@/lib/db/audit";
import { ambienteActual, getPhotoStatus } from "@/lib/db/collections";
import { getSetting } from "@/lib/collections/store";
import { UMBRAL_MORA_DEFAULT, fechaMexico } from "@/lib/collections/rules";
import {
  ESTADOS_ABIERTOS,
  ESTADOS_OPORTUNIDAD,
  diasParaFin,
  evaluarRenovacion,
  leerAjustesRenovacion,
  planRadar,
  tareaDeVentana,
  validarCambioOportunidad,
  ventanaDe,
  type AjustesRenovacion,
  type CreditoRenovacion,
  type EstadoOportunidad,
  type Evaluacion,
} from "@/lib/clientes/renovaciones";

export class OportunidadError extends Error {}

const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));

export async function getAjustesRenovacion(): Promise<AjustesRenovacion> {
  const [r] = await sql`SELECT value FROM crm_settings WHERE key = 'renovaciones'`;
  return leerAjustesRenovacion(r?.value);
}

/** Créditos del ambiente ligados a una empresa, con los datos de la foto `fechaCorte` (null si no vienen en ella). */
async function creditosConFoto(fechaCorte: string) {
  const rows = await sql`
    SELECT cr.id, c.empresa_id, e.nombre AS empresa, e.ejecutivo_email, a.nombre AS ejecutivo_nombre,
           cr.no_credito, cr.en_listado, cr.etapa_manual, cr.monto_credito, cr.vencimientos,
           to_char(cr.fecha_termino_contrato, 'YYYY-MM-DD') AS fecha_termino,
           s.antiguedad, s.total_vencido, s.atraso_maximo, s.numero_veces_mora, s.vencimientos_cubiertos
    FROM col_credits cr
    JOIN col_clients c ON c.id = cr.client_id
    JOIN crm_empresas e ON e.id = c.empresa_id
    LEFT JOIN admin_users a ON a.email = e.ejecutivo_email
    LEFT JOIN col_credit_snapshots s ON s.credit_id = cr.id AND s.fecha_corte = ${fechaCorte}::date
    WHERE cr.ambiente = ${ambienteActual()}
  `;
  return rows.map((r) => ({
    credito: {
      creditId: r.id as string,
      empresaId: r.empresa_id as string,
      noCredito: r.no_credito as string,
      enListado: r.en_listado as boolean,
      fechaTermino: (r.fecha_termino as string) ?? null,
      montoCredito: num(r.monto_credito),
      atraso: num(r.antiguedad),
      vencido: num(r.total_vencido),
      atrasoMaximo: num(r.atraso_maximo),
      vecesMora: num(r.numero_veces_mora),
      etapaManual: (r.etapa_manual as string) ?? null,
      cubiertos: num(r.vencimientos_cubiertos),
      vencimientos: num(r.vencimientos),
    } satisfies CreditoRenovacion,
    empresa: r.empresa as string,
    ejecutivoEmail: (r.ejecutivo_email as string) ?? null,
    ejecutivoNombre: (r.ejecutivo_nombre as string) ?? null,
  }));
}

export type ResultadoRadar =
  | { corrio: false; motivo: string }
  | { corrio: true; fechaCorte: string; abiertas: number; recordatorios: number; cerradas: number };

/**
 * Corre el radar con la foto de hoy: abre oportunidades, deja las tareas de cada
 * ventana y cierra las que ya no aplican. Lo llama el cron después de la foto
 * diaria; correrlo otra vez el mismo día no duplica nada.
 */
export async function correrRadar(p: { actor: string }): Promise<ResultadoRadar> {
  const hoy = fechaMexico();
  const status = await getPhotoStatus();
  if (status.fechaCorte !== hoy) return { corrio: false, motivo: status.fechaCorte ? `La foto de SIAC no es de hoy (última: ${status.fechaCorte})` : "Todavía no hay foto de SIAC" };
  const [{ existe }] = await sql`SELECT to_regclass('public.crm_oportunidades') IS NOT NULL AS existe`;
  if (!existe) return { corrio: false, motivo: "Falta correr crm-schema.sql en la base (tabla crm_oportunidades)" };

  const ambiente = ambienteActual();
  const [ajustes, umbralMora, filas, oportunidades, [porOmision]] = await Promise.all([
    getAjustesRenovacion(),
    getSetting("umbral_mora", UMBRAL_MORA_DEFAULT),
    creditosConFoto(hoy),
    sql`
      SELECT o.id, o.empresa_id, o.credit_id, o.estado, o.responsable_email
      FROM crm_oportunidades o JOIN crm_empresas e ON e.id = o.empresa_id
      WHERE e.ambiente = ${ambiente} AND o.origen = 'radar'
    `,
    sql`SELECT a.email FROM crm_settings s JOIN admin_users a ON a.email = s.value->>'email' AND a.activo WHERE s.key = 'ejecutivo_por_omision'`,
  ]);
  const ejecutivoDe = new Map(filas.map((f) => [f.credito.empresaId, f.ejecutivoEmail]));
  const responsableDe = (empresaId: string) => ejecutivoDe.get(empresaId) ?? (porOmision?.email as string | undefined) ?? null;
  const responsableOp = new Map(oportunidades.map((o) => [String(o.id), (o.responsable_email as string) ?? null]));

  const acciones = planRadar({
    creditos: filas.map((f) => f.credito),
    oportunidades: oportunidades.map((o) => ({ id: String(o.id), empresaId: o.empresa_id, creditId: o.credit_id, estado: o.estado })),
    ajustes,
    umbralMora,
    hoy,
  });

  let abiertas = 0;
  let recordatorios = 0;
  let cerradas = 0;
  for (const a of acciones) {
    if (a.tipo === "abrir") {
      const c = a.credito;
      const responsable = responsableDe(c.empresaId);
      const creada = await transaccion(async (tx) => {
        const [o] = await tx`
          INSERT INTO crm_oportunidades (empresa_id, credit_id, tipo, estado, origen, fecha_termino, monto_referencia, fecha_corte, razones, responsable_email, created_by)
          VALUES (${c.empresaId}, ${c.creditId}, 'renovacion', 'abierta', 'radar', ${c.fechaTermino}, ${c.montoCredito}, ${hoy},
                  ${JSON.stringify(a.razones)}::text::jsonb, ${responsable}, ${p.actor})
          ON CONFLICT DO NOTHING
          RETURNING id
        `;
        if (!o) return false;
        const t = tareaDeVentana(a.ventana, ajustes.ventanas, c, true);
        await tx`
          INSERT INTO crm_tareas (empresa_id, credit_id, titulo, descripcion, tipo, vence_el, responsable_email, origen, dedupe_key, created_by)
          VALUES (${c.empresaId}, ${c.creditId}, ${t.titulo}, ${t.descripcion}, ${t.tipo}, ${hoy}, ${responsable},
                  ${`oportunidad:${o.id}`}, ${`renovacion:${o.id}:${a.ventana}`}, ${p.actor})
          ON CONFLICT DO NOTHING
        `;
        await tx`
          INSERT INTO crm_actividades (empresa_id, tipo, descripcion, actor)
          VALUES (${c.empresaId}, 'nota', ${`Se abrió una oportunidad de renovación: el crédito ${c.noCredito} está por terminar y la empresa califica. ${a.razones.join(". ")}.`}, 'sistema')
        `;
        return true;
      });
      if (creada) abiertas++;
    } else if (a.tipo === "recordar") {
      const c = a.credito;
      const t = tareaDeVentana(a.ventana, ajustes.ventanas, c, false);
      const dedupe = `renovacion:${a.oportunidadId}:${a.ventana}`;
      const responsable = responsableOp.get(a.oportunidadId) ?? responsableDe(c.empresaId);
      // Una tarea por ventana, aunque la anterior ya se haya cerrado.
      const r = await sql`
        INSERT INTO crm_tareas (empresa_id, credit_id, titulo, descripcion, tipo, vence_el, responsable_email, origen, dedupe_key, created_by)
        SELECT ${c.empresaId}, ${c.creditId}, ${t.titulo}, ${t.descripcion}, ${t.tipo}, ${hoy}, ${responsable},
               ${`oportunidad:${a.oportunidadId}`}, ${dedupe}, ${p.actor}
        WHERE NOT EXISTS (SELECT 1 FROM crm_tareas WHERE dedupe_key = ${dedupe})
        ON CONFLICT DO NOTHING
        RETURNING id
      `;
      if (r.length) recordatorios++;
    } else {
      const cerrada = await cerrarOportunidad({ id: a.oportunidadId, empresaId: a.empresaId, estado: "cerrada", motivo: a.motivo, actor: "sistema" });
      if (cerrada) cerradas++;
    }
  }
  if (abiertas || recordatorios || cerradas) {
    await logAudit({ actorEmail: p.actor, action: "radar_renovaciones", entityType: "crm_oportunidades", metadata: { fechaCorte: hoy, abiertas, recordatorios, cerradas } });
  }
  return { corrio: true, fechaCorte: hoy, abiertas, recordatorios, cerradas };
}

/** Cierra una oportunidad abierta, cancela sus tareas pendientes y deja la nota en la actividad. */
async function cerrarOportunidad(p: { id: string; empresaId: string; estado: "ganada" | "descartada" | "cerrada"; motivo: string | null; actor: string }): Promise<boolean> {
  return transaccion(async (tx) => {
    const [o] = await tx`
      UPDATE crm_oportunidades
      SET estado = ${p.estado}, motivo_cierre = ${p.motivo}, cerrada_por = ${p.actor}, cerrada_at = now(), updated_by = ${p.actor}, updated_at = now()
      WHERE id = ${p.id} AND empresa_id = ${p.empresaId} AND estado = ANY(${ESTADOS_ABIERTOS})
      RETURNING id
    `;
    if (!o) return false;
    await tx`
      UPDATE crm_tareas SET estado = 'cancelada', resultado = ${`Se cerró la oportunidad de renovación: ${ESTADOS_OPORTUNIDAD[p.estado].toLowerCase()}${p.motivo ? `. ${p.motivo}` : ""}`},
             cerrada_por = ${p.actor}, cerrada_at = now()
      WHERE origen = ${`oportunidad:${p.id}`} AND estado = 'abierta'
    `;
    await tx`
      INSERT INTO crm_actividades (empresa_id, tipo, descripcion, actor)
      VALUES (${p.empresaId}, 'nota', ${`Oportunidad de renovación: ${ESTADOS_OPORTUNIDAD[p.estado]}${p.motivo ? `. ${p.motivo}` : ""}`}, ${p.actor})
    `;
    return true;
  });
}

/** Una persona mueve la oportunidad: en contacto, interesado, pasó a análisis o descartada. */
export async function cambiarEstadoOportunidad(p: { empresaId: string; id: string; estado: string; motivo: string; actor: string }) {
  if (!/^\d{1,18}$/.test(p.id)) throw new OportunidadError("Esa oportunidad no existe.");
  const [o] = await sql`SELECT estado FROM crm_oportunidades WHERE id = ${p.id} AND empresa_id = ${p.empresaId}`;
  if (!o) throw new OportunidadError("Esa oportunidad no existe.");
  const v = validarCambioOportunidad(o.estado as EstadoOportunidad, p.estado, p.motivo);
  if (!v.ok) throw new OportunidadError(v.error);
  if (v.estado === "ganada" || v.estado === "descartada") {
    const ok = await cerrarOportunidad({ id: p.id, empresaId: p.empresaId, estado: v.estado, motivo: v.motivo, actor: p.actor });
    if (!ok) throw new OportunidadError("Esta oportunidad ya está cerrada.");
  } else {
    await transaccion(async (tx) => {
      const [u] = await tx`
        UPDATE crm_oportunidades SET estado = ${v.estado}, updated_by = ${p.actor}, updated_at = now()
        WHERE id = ${p.id} AND empresa_id = ${p.empresaId} AND estado = ${o.estado}
        RETURNING id
      `;
      if (!u) throw new OportunidadError("Alguien más acaba de cambiar esta oportunidad. Recarga la página.");
      await tx`
        INSERT INTO crm_actividades (empresa_id, tipo, descripcion, actor)
        VALUES (${p.empresaId}, 'nota', ${`Oportunidad de renovación: ${ESTADOS_OPORTUNIDAD[v.estado]}${v.motivo ? `. ${v.motivo}` : ""}`}, ${p.actor})
      `;
    });
  }
  await logAudit({ actorEmail: p.actor, action: "cambiar_oportunidad", entityType: "oportunidad", entityId: p.id, metadata: { empresaId: p.empresaId, de: o.estado, a: v.estado } });
}

export interface Oportunidad {
  id: string;
  empresaId: string;
  creditId: string | null;
  noCredito: string | null;
  estado: EstadoOportunidad;
  fechaTermino: string | null;
  montoReferencia: number | null;
  fechaCorte: string;
  razones: string[];
  responsableEmail: string | null;
  responsableNombre: string | null;
  motivoCierre: string | null;
  cerradaPor: string | null;
  cerradaAt: string | null;
  createdAt: string;
}

const mapOportunidad = (r: Record<string, unknown>): Oportunidad => ({
  id: String(r.id),
  empresaId: r.empresa_id as string,
  creditId: (r.credit_id as string) ?? null,
  noCredito: (r.no_credito as string) ?? null,
  estado: r.estado as EstadoOportunidad,
  fechaTermino: (r.fecha_termino as string) ?? null,
  montoReferencia: num(r.monto_referencia),
  fechaCorte: r.fecha_corte as string,
  razones: Array.isArray(r.razones) ? (r.razones as string[]) : [],
  responsableEmail: (r.responsable_email as string) ?? null,
  responsableNombre: (r.responsable_nombre as string) ?? null,
  motivoCierre: (r.motivo_cierre as string) ?? null,
  cerradaPor: (r.cerrada_por as string) ?? null,
  cerradaAt: r.cerrada_at ? (r.cerrada_at as Date).toISOString() : null,
  createdAt: (r.created_at as Date).toISOString(),
});

const SELECT_OPORTUNIDAD = () => sql`
  SELECT o.*, to_char(o.fecha_termino, 'YYYY-MM-DD') AS fecha_termino, to_char(o.fecha_corte, 'YYYY-MM-DD') AS fecha_corte,
         cr.no_credito, a.nombre AS responsable_nombre
  FROM crm_oportunidades o
  LEFT JOIN col_credits cr ON cr.id = o.credit_id
  LEFT JOIN admin_users a ON a.email = o.responsable_email
`;

/** Oportunidades de una empresa, la abierta primero. Vacío si todavía no se corrió el esquema. */
export async function getOportunidadesEmpresa(empresaId: string): Promise<Oportunidad[]> {
  const [{ existe }] = await sql`SELECT to_regclass('public.crm_oportunidades') IS NOT NULL AS existe`;
  if (!existe) return [];
  const rows = await sql`
    ${SELECT_OPORTUNIDAD()} WHERE o.empresa_id = ${empresaId}
    ORDER BY (o.estado = ANY(${ESTADOS_ABIERTOS})) DESC, o.created_at DESC LIMIT 20
  `;
  return rows.map(mapOportunidad);
}

export interface FilaRadar {
  creditId: string;
  empresaId: string;
  empresa: string;
  ejecutivoEmail: string | null;
  ejecutivoNombre: string | null;
  noCredito: string;
  fechaTermino: string;
  dias: number;
  ventana: number | null;
  montoCredito: number | null;
  cubiertos: number | null;
  vencimientos: number | null;
  evaluacion: Evaluacion;
  oportunidad: { id: string; estado: EstadoOportunidad } | null;
}

/**
 * Créditos vigentes que terminan dentro de la ventana mayor (o que ya
 * terminaron y siguen en el listado), con si califican y su oportunidad.
 * Usa la última foto completa.
 */
export async function getRadar() {
  const hoy = fechaMexico();
  const status = await getPhotoStatus();
  const ajustes = await getAjustesRenovacion();
  if (!status.fechaCorte) return { hoy, status, ajustes, filas: [] as FilaRadar[], esquema: true };
  const [filas, [{ existe }]] = await Promise.all([creditosConFoto(status.fechaCorte), sql`SELECT to_regclass('public.crm_oportunidades') IS NOT NULL AS existe`]);
  const oportunidades = existe
    ? await sql`
        SELECT o.id, o.credit_id, o.estado FROM crm_oportunidades o JOIN crm_empresas e ON e.id = o.empresa_id
        WHERE e.ambiente = ${ambienteActual()} AND o.credit_id IS NOT NULL ORDER BY o.created_at
      `
    : [];
  const opPorCredito = new Map(oportunidades.map((o) => [o.credit_id as string, { id: String(o.id), estado: o.estado as EstadoOportunidad }]));
  const vigentesPorEmpresa = new Map<string, CreditoRenovacion[]>();
  for (const f of filas.filter((f) => f.credito.enListado)) vigentesPorEmpresa.set(f.credito.empresaId, [...(vigentesPorEmpresa.get(f.credito.empresaId) ?? []), f.credito]);
  const mayor = Math.max(...ajustes.ventanas);

  const radar: FilaRadar[] = filas
    .filter((f) => f.credito.enListado && f.credito.fechaTermino && diasParaFin(f.credito.fechaTermino, hoy) <= mayor)
    .map((f) => {
      const c = f.credito;
      const dias = diasParaFin(c.fechaTermino!, hoy);
      return {
        creditId: c.creditId,
        empresaId: c.empresaId,
        empresa: f.empresa,
        ejecutivoEmail: f.ejecutivoEmail,
        ejecutivoNombre: f.ejecutivoNombre,
        noCredito: c.noCredito,
        fechaTermino: c.fechaTermino!,
        dias,
        ventana: ventanaDe(dias, ajustes.ventanas),
        montoCredito: c.montoCredito,
        cubiertos: c.cubiertos,
        vencimientos: c.vencimientos,
        evaluacion: evaluarRenovacion(c, vigentesPorEmpresa.get(c.empresaId) ?? [], ajustes, hoy),
        oportunidad: opPorCredito.get(c.creditId) ?? null,
      };
    })
    .sort((a, b) => a.dias - b.dias || a.empresa.localeCompare(b.empresa, "es", { sensitivity: "base" }));
  return { hoy, status, ajustes, filas: radar, esquema: !!existe };
}
