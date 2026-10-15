// Colocación de los brokers en la base del backoffice (broker_colocaciones).
// Reemplaza a los webhooks broker-portal-stats y broker-portal-leaderboard de
// n8n, que leían el Sheet "Historial Colocacion": mismas respuestas, otra
// fuente. Todo cambio queda en audit_log.

import { sql, transaccion } from "@/lib/db";
import { logAudit } from "@/lib/db/audit";
import { nombresDeBrokers } from "@/lib/db/brokers";
import { fechaMexico } from "@/lib/collections/rules";
import type { BrokerStats, LeaderboardResponse } from "@/lib/n8n";
import {
  armarRanking,
  calcularStats,
  claveColocacion,
  revisarColocacion,
  validarColocacion,
  type Colocacion,
  type FilaColocacion,
} from "@/lib/brokers/colocacion";

export class ColocacionError extends Error {}

const mapColocacion = (r: Record<string, unknown>): Colocacion => ({
  id: Number(r.id),
  brokerId: r.broker_id as string,
  fecha: (r.fecha as Date).toISOString().slice(0, 10),
  monto: Number(r.monto),
  comisionAperturaPct: r.comision_apertura_pct === null ? null : Number(r.comision_apertura_pct),
  pagadoTotalidad: Boolean(r.pagado_totalidad),
  referencia: (r.referencia as string | null) ?? null,
});

export async function listColocaciones(brokerId?: string): Promise<Colocacion[]> {
  const rows = brokerId
    ? await sql`SELECT * FROM broker_colocaciones WHERE broker_id = ${brokerId} ORDER BY fecha DESC, id DESC`
    : await sql`SELECT * FROM broker_colocaciones ORDER BY fecha DESC, id DESC`;
  return rows.map(mapColocacion);
}

/** Lo que regresaba el webhook broker-portal-stats. */
export async function getStats(brokerId: string): Promise<BrokerStats> {
  return calcularStats(await listColocaciones(brokerId));
}

/** Lo que regresaba el webhook broker-portal-leaderboard, con los nombres de la tabla brokers. */
export async function getLeaderboard(): Promise<LeaderboardResponse> {
  const [colocaciones, nombres] = await Promise.all([listColocaciones(), nombresDeBrokers()]);
  return { ranking: armarRanking(colocaciones, nombres), criterioActual: "monto" };
}

type Captura = { brokerId: string; fecha: string; monto: string; comisionAperturaPct?: string; pagadoTotalidad?: string; referencia?: string };

function validar(p: Captura) {
  const v = validarColocacion(p, fechaMexico());
  if (!v.ok) throw new ColocacionError(v.error);
  return v;
}

export async function crearColocacion(p: Captura & { actor: string }): Promise<void> {
  const v = validar(p);
  const [broker] = await sql`SELECT id FROM brokers WHERE id = ${v.brokerId}`;
  if (!broker) throw new ColocacionError(`El broker ${v.brokerId} no está dado de alta`);
  const [row] = await sql`
    INSERT INTO broker_colocaciones (broker_id, fecha, monto, comision_apertura_pct, pagado_totalidad, referencia, created_by)
    VALUES (${v.brokerId}, ${v.fecha}, ${v.monto}, ${v.comisionAperturaPct}, ${v.pagadoTotalidad}, ${v.referencia}, ${p.actor})
    RETURNING id
  `;
  await logAudit({ actorEmail: p.actor, action: "crear_colocacion", entityType: "broker", entityId: v.brokerId, metadata: { colocacionId: Number(row.id), fecha: v.fecha, monto: v.monto } });
}

export async function editarColocacion(p: Captura & { id: number; actor: string }): Promise<void> {
  const v = validar(p);
  const [row] = await sql`
    UPDATE broker_colocaciones
    SET fecha = ${v.fecha}, monto = ${v.monto}, comision_apertura_pct = ${v.comisionAperturaPct}, pagado_totalidad = ${v.pagadoTotalidad},
        referencia = ${v.referencia}, updated_by = ${p.actor}, updated_at = now()
    WHERE id = ${p.id} AND broker_id = ${v.brokerId}
    RETURNING id
  `;
  if (!row) throw new ColocacionError("Esa operación ya no existe");
  await logAudit({ actorEmail: p.actor, action: "editar_colocacion", entityType: "broker", entityId: v.brokerId, metadata: { colocacionId: p.id, fecha: v.fecha, monto: v.monto } });
}

export async function eliminarColocacion(p: { id: number; brokerId: string; actor: string }): Promise<void> {
  const [row] = await sql`DELETE FROM broker_colocaciones WHERE id = ${p.id} AND broker_id = ${p.brokerId} RETURNING fecha, monto`;
  if (!row) throw new ColocacionError("Esa operación ya no existe");
  await logAudit({
    actorEmail: p.actor,
    action: "eliminar_colocacion",
    entityType: "broker",
    entityId: p.brokerId,
    metadata: { colocacionId: p.id, fecha: (row.fecha as Date).toISOString().slice(0, 10), monto: Number(row.monto) },
  });
}

async function contexto(): Promise<{ brokers: Set<string>; claves: string[] }> {
  const [brokers, colocaciones] = await Promise.all([sql`SELECT id FROM brokers`, listColocaciones()]);
  return { brokers: new Set(brokers.map((r) => r.id as string)), claves: colocaciones.map(claveColocacion) };
}

export async function previsualizarColocacion(texto: string): Promise<{ filas: FilaColocacion[] } | { error: string }> {
  const { brokers, claves } = await contexto();
  return revisarColocacion(texto, brokers, claves, fechaMexico());
}

/**
 * Guarda la carga masiva. Se vuelve a validar contra la base en este momento
 * (no se confía en la vista previa); las filas con error o ya guardadas se omiten.
 */
export async function importarColocacion(texto: string, actor: string): Promise<{ creadas: number; existentes: number; errores: number; monto: number }> {
  const { brokers, claves } = await contexto();
  const r = revisarColocacion(texto, brokers, claves, fechaMexico());
  if ("error" in r) throw new ColocacionError(r.error);
  const nuevas = r.filas.filter((f) => f.estado === "nuevo");
  if (nuevas.length > 0) {
    const filas = nuevas.map((f) => ({
      broker_id: f.brokerId,
      fecha: f.fecha,
      monto: f.monto,
      comision_apertura_pct: f.comisionAperturaPct,
      pagado_totalidad: f.pagadoTotalidad,
      referencia: f.referencia,
      created_by: actor,
    }));
    await transaccion(async (tx) => {
      // De a 500 para no pasar el límite de parámetros de Postgres.
      for (let i = 0; i < filas.length; i += 500) {
        const lote = filas.slice(i, i + 500);
        await tx`INSERT INTO broker_colocaciones ${tx(lote, "broker_id", "fecha", "monto", "comision_apertura_pct", "pagado_totalidad", "referencia", "created_by")}`;
      }
    });
  }
  const resultado = {
    creadas: nuevas.length,
    existentes: r.filas.filter((f) => f.estado === "existe").length,
    errores: r.filas.filter((f) => f.estado === "error").length,
    monto: nuevas.reduce((s, f) => s + (f.monto ?? 0), 0),
  };
  await logAudit({ actorEmail: actor, action: "importar_colocacion", entityType: "broker", metadata: resultado });
  return resultado;
}
