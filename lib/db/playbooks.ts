// Playbooks de seguimiento: lee la foto de hoy, decide qué tareas tocan
// (lib/clientes/playbooks.ts) y las crea. Nada de aquí escribe en tablas col_*.

import { sql } from "@/lib/db";
import { logAudit } from "@/lib/db/audit";
import { ambienteActual, getPhotoStatus } from "@/lib/db/collections";
import { getEmpresasLista } from "@/lib/db/empresas";
import { relacionDeEmpresas } from "@/lib/db/cartera";
import { fechaMexico } from "@/lib/collections/rules";
import { leerAjustesPlaybooks, planPlaybooks, type AjustesPlaybooks, type ClavePlaybook } from "@/lib/clientes/playbooks";

export async function getAjustesPlaybooks(): Promise<AjustesPlaybooks> {
  const [r] = await sql`SELECT value FROM crm_settings WHERE key = 'playbooks'`;
  return leerAjustesPlaybooks(r?.value);
}

export type ResultadoPlaybooks = { corrio: false; motivo: string } | { corrio: true; creadas: number; porPlaybook: Partial<Record<ClavePlaybook, number>> };

/**
 * Crea las tareas de los playbooks que tocan hoy, con la foto de hoy. Cada tarea
 * tiene una llave única: si ya existe (abierta o cerrada) no se vuelve a crear.
 */
export async function correrPlaybooks(p: { actor: string }): Promise<ResultadoPlaybooks> {
  const hoy = fechaMexico();
  const status = await getPhotoStatus();
  if (status.fechaCorte !== hoy) return { corrio: false, motivo: status.fechaCorte ? `La foto de SIAC no es de hoy (última: ${status.fechaCorte})` : "Todavía no hay foto de SIAC" };
  const ajustes = await getAjustesPlaybooks();
  if (!ajustes.activo) return { corrio: false, motivo: "Los playbooks están apagados (crm_settings → playbooks)" };

  const ambiente = ambienteActual();
  const [lista, creditos, [primera], revisiones, [{ hayOportunidades }], [porOmision]] = await Promise.all([
    getEmpresasLista(hoy, { filtro: "todos", q: "", orden: "nombre", yo: "" }),
    sql`
      SELECT cr.id, c.empresa_id, cr.no_credito, cr.en_listado,
             to_char(cr.fecha_ministracion, 'YYYY-MM-DD') AS fecha_ministracion,
             (SELECT to_char(min(s.fecha_corte), 'YYYY-MM-DD') FROM col_credit_snapshots s WHERE s.credit_id = cr.id) AS primera_foto,
             (SELECT to_char(max(e.fecha_evento), 'YYYY-MM-DD') FROM col_credit_events e WHERE e.credit_id = cr.id AND e.tipo = 'salida_listado') AS salio_el,
             h.vencimientos_cubiertos, to_char(h.proximo_vencimiento, 'YYYY-MM-DD') AS proximo_vencimiento
      FROM col_credits cr
      JOIN col_clients c ON c.id = cr.client_id
      LEFT JOIN col_credit_snapshots h ON h.credit_id = cr.id AND h.fecha_corte = ${hoy}::date
      WHERE cr.ambiente = ${ambiente} AND c.empresa_id IS NOT NULL
    `,
    sql`SELECT to_char(min(fecha_corte), 'YYYY-MM-DD') AS fecha FROM col_sync_runs WHERE ambiente = ${ambiente} AND tipo = 'diaria' AND status = 'completado'`,
    sql`
      SELECT t.empresa_id, to_char(max((t.created_at AT TIME ZONE 'America/Mexico_City')::date), 'YYYY-MM-DD') AS ultima
      FROM crm_tareas t WHERE t.origen = 'playbook:revision' GROUP BY t.empresa_id
    `,
    sql`SELECT to_regclass('public.crm_oportunidades') IS NOT NULL AS "hayOportunidades"`,
    sql`SELECT a.email FROM crm_settings s JOIN admin_users a ON a.email = s.value->>'email' AND a.activo WHERE s.key = 'ejecutivo_por_omision'`,
  ]);
  const conOportunidad = new Set<string>(
    hayOportunidades
      ? (await sql`SELECT DISTINCT empresa_id FROM crm_oportunidades WHERE estado IN ('abierta', 'en_contacto', 'interesado')`).map((r) => r.empresa_id as string)
      : [],
  );
  const ultimaRevision = new Map(revisiones.map((r) => [r.empresa_id as string, r.ultima as string]));
  const relacion = await relacionDeEmpresas(lista.items.map((e) => e.empresaId));

  const tareas = planPlaybooks({
    creditos: creditos.map((c) => ({
      creditId: c.id as string,
      empresaId: c.empresa_id as string,
      noCredito: c.no_credito as string,
      enListado: c.en_listado as boolean,
      primeraFoto: (c.primera_foto as string) ?? null,
      salioEl: (c.salio_el as string) ?? null,
      cubiertos: c.vencimientos_cubiertos === null ? null : Number(c.vencimientos_cubiertos),
      proximoVencimiento: (c.proximo_vencimiento as string) ?? null,
      fechaMinistracion: (c.fecha_ministracion as string) ?? null,
    })),
    empresas: lista.items.map((e) => {
      const r = relacion.get(e.empresaId);
      return {
        empresaId: e.empresaId,
        enMora: e.enMora,
        especial: e.etapa === "cobranza_especial",
        cuentaPago: r?.cuentaPago ?? false,
        whatsappValido: r?.whatsappValido ?? false,
        ultimoContacto: r?.ultimoContacto ?? null,
        ultimaRevision: ultimaRevision.get(e.empresaId) ?? null,
        oportunidadAbierta: conOportunidad.has(e.empresaId),
      };
    }),
    ajustes,
    primeraFotoSistema: (primera?.fecha as string) ?? null,
    hoy,
  });

  const ejecutivo = new Map(lista.items.map((e) => [e.empresaId, e.ejecutivoEmail]));
  const porPlaybook: Partial<Record<ClavePlaybook, number>> = {};
  let creadas = 0;
  for (const t of tareas) {
    const responsable = ejecutivo.get(t.empresaId) ?? (porOmision?.email as string | undefined) ?? null;
    const r = await sql`
      INSERT INTO crm_tareas (empresa_id, credit_id, titulo, descripcion, tipo, vence_el, responsable_email, origen, dedupe_key, created_by)
      SELECT ${t.empresaId}, ${t.creditId}, ${t.titulo}, ${t.descripcion}, ${t.tipo}, ${t.venceEl}, ${responsable},
             ${`playbook:${t.clave}`}, ${t.dedupeKey}, ${p.actor}
      WHERE NOT EXISTS (SELECT 1 FROM crm_tareas WHERE dedupe_key = ${t.dedupeKey})
      ON CONFLICT DO NOTHING
      RETURNING id
    `;
    if (r.length) {
      creadas++;
      porPlaybook[t.clave] = (porPlaybook[t.clave] ?? 0) + 1;
    }
  }
  if (creadas) await logAudit({ actorEmail: p.actor, action: "playbooks", entityType: "crm_tareas", metadata: { fechaCorte: hoy, creadas, porPlaybook } });
  return { corrio: true, creadas, porPlaybook };
}
