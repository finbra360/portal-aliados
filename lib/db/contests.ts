import { sql } from "@/lib/db";
import { logAudit } from "./audit";
import type { LeaderboardCriterio } from "@/lib/n8n";

export type ContestStatus = "borrador" | "activo" | "pausado" | "finalizado";

export interface Contest {
  id: number;
  nombre: string;
  descripcion: string | null;
  fechaInicio: string;
  fechaFin: string;
  criterio: LeaderboardCriterio;
  metaObjetivo: number | null;
  premio: string;
  numGanadores: number;
  estatus: ContestStatus;
  createdAt: string;
}

function toDateString(value: unknown): string {
  return value instanceof Date ? value.toISOString().slice(0, 10) : String(value);
}

function mapRow(r: Record<string, unknown>): Contest {
  return {
    id: r.id as number,
    nombre: r.nombre as string,
    descripcion: (r.descripcion as string) ?? null,
    fechaInicio: toDateString(r.fecha_inicio),
    fechaFin: toDateString(r.fecha_fin),
    criterio: r.criterio as LeaderboardCriterio,
    metaObjetivo: r.meta_objetivo !== null ? Number(r.meta_objetivo) : null,
    premio: r.premio as string,
    numGanadores: r.num_ganadores as number,
    estatus: r.estatus as ContestStatus,
    createdAt: (r.created_at as Date).toISOString(),
  };
}

export async function listContests(): Promise<Contest[]> {
  const rows = await sql`SELECT * FROM contests ORDER BY created_at DESC`;
  return rows.map(mapRow);
}

export async function listActiveContests(): Promise<Contest[]> {
  const rows = await sql`SELECT * FROM contests WHERE estatus = 'activo' ORDER BY fecha_fin ASC`;
  return rows.map(mapRow);
}

export async function getContest(id: number): Promise<Contest | null> {
  const rows = await sql`SELECT * FROM contests WHERE id = ${id}`;
  return rows[0] ? mapRow(rows[0]) : null;
}

export async function getContestExclusions(contestId: number): Promise<string[]> {
  const rows = await sql`SELECT broker_id FROM contest_exclusions WHERE contest_id = ${contestId}`;
  return rows.map((r) => r.broker_id as string);
}

export async function createContest(params: {
  nombre: string;
  descripcion?: string;
  fechaInicio: string;
  fechaFin: string;
  criterio: LeaderboardCriterio;
  metaObjetivo?: number;
  premio: string;
  numGanadores: number;
  actorEmail: string;
}): Promise<Contest> {
  const rows = await sql`
    INSERT INTO contests (nombre, descripcion, fecha_inicio, fecha_fin, criterio, meta_objetivo, premio, num_ganadores, created_by)
    VALUES (
      ${params.nombre}, ${params.descripcion ?? null}, ${params.fechaInicio}, ${params.fechaFin},
      ${params.criterio}, ${params.metaObjetivo ?? null}, ${params.premio}, ${params.numGanadores}, ${params.actorEmail}
    )
    RETURNING *
  `;
  const contest = mapRow(rows[0]);
  await logAudit({ actorEmail: params.actorEmail, action: "create_contest", entityType: "contest", entityId: String(contest.id) });
  return contest;
}

export async function setContestStatus(params: { id: number; estatus: ContestStatus; actorEmail: string }): Promise<Contest> {
  const rows = await sql`UPDATE contests SET estatus = ${params.estatus} WHERE id = ${params.id} RETURNING *`;
  if (!rows[0]) {
    throw new Error("Concurso no encontrado");
  }
  await logAudit({
    actorEmail: params.actorEmail,
    action: "update_contest_status",
    entityType: "contest",
    entityId: String(params.id),
    metadata: { newEstatus: params.estatus },
  });
  return mapRow(rows[0]);
}

export async function excludeBrokerFromContest(params: { contestId: number; brokerId: string; actorEmail: string }): Promise<void> {
  await sql`INSERT INTO contest_exclusions (contest_id, broker_id) VALUES (${params.contestId}, ${params.brokerId}) ON CONFLICT DO NOTHING`;
  await logAudit({
    actorEmail: params.actorEmail,
    action: "exclude_broker_from_contest",
    entityType: "contest",
    entityId: String(params.contestId),
    metadata: { brokerId: params.brokerId },
  });
}
