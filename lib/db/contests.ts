import { sql, transaccion } from "@/lib/db";
import { logAudit } from "./audit";
import { nombresDeBrokers } from "./brokers";
import {
  ganadoresDeConcurso,
  posicionesDeConcurso,
  type ColocacionDeConcurso,
  type ConcursoNuevo,
  type CriterioConcurso,
  type PosicionConcurso,
} from "@/lib/concursos";

export type ContestStatus = "borrador" | "activo" | "pausado" | "finalizado";

export class ConcursoError extends Error {}

export interface Contest {
  id: number;
  nombre: string;
  descripcion: string | null;
  fechaInicio: string;
  fechaFin: string;
  criterio: CriterioConcurso;
  metaObjetivo: number | null;
  premio: string;
  numGanadores: number;
  estatus: ContestStatus;
  finalizadoAt: string | null;
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
    criterio: r.criterio as CriterioConcurso,
    metaObjetivo: r.meta_objetivo !== null ? Number(r.meta_objetivo) : null,
    premio: r.premio as string,
    numGanadores: r.num_ganadores as number,
    estatus: r.estatus as ContestStatus,
    finalizadoAt: r.finalizado_at ? (r.finalizado_at as Date).toISOString() : null,
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

/** Los finalizados más recientes, para mostrar sus ganadores en el portal. */
export async function listFinishedContests(limit = 5): Promise<Contest[]> {
  const rows = await sql`SELECT * FROM contests WHERE estatus = 'finalizado' ORDER BY fecha_fin DESC, id DESC LIMIT ${limit}`;
  return rows.map(mapRow);
}

export async function getContest(id: number): Promise<Contest | null> {
  const rows = await sql`SELECT * FROM contests WHERE id = ${id}`;
  return rows[0] ? mapRow(rows[0]) : null;
}

export async function getContestExclusions(contestId: number): Promise<string[]> {
  const rows = await sql`SELECT broker_id FROM contest_exclusions WHERE contest_id = ${contestId} ORDER BY broker_id`;
  return rows.map((r) => r.broker_id as string);
}

export async function createContest(params: ConcursoNuevo & { actorEmail: string }): Promise<Contest> {
  const rows = await sql`
    INSERT INTO contests (nombre, descripcion, fecha_inicio, fecha_fin, criterio, meta_objetivo, premio, num_ganadores, created_by)
    VALUES (
      ${params.nombre}, ${params.descripcion}, ${params.fechaInicio}, ${params.fechaFin},
      ${params.criterio}, ${params.metaObjetivo}, ${params.premio}, ${params.numGanadores}, ${params.actorEmail}
    )
    RETURNING *
  `;
  const contest = mapRow(rows[0]);
  await logAudit({ actorEmail: params.actorEmail, action: "create_contest", entityType: "contest", entityId: String(contest.id) });
  return contest;
}

/** Activar, pausar o regresar a borrador. Finalizar se hace con `finalizarConcurso`, que fija a los ganadores. */
export async function setContestStatus(params: { id: number; estatus: Exclude<ContestStatus, "finalizado">; actorEmail: string }): Promise<Contest> {
  const rows = await sql`
    UPDATE contests SET estatus = ${params.estatus}
    WHERE id = ${params.id} AND estatus <> 'finalizado'
    RETURNING *
  `;
  if (!rows[0]) {
    const existe = await getContest(params.id);
    throw new ConcursoError(existe ? "Un concurso finalizado ya no se puede reabrir" : "Concurso no encontrado");
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
  const [broker] = await sql`SELECT id FROM brokers WHERE id = ${params.brokerId}`;
  if (!broker) throw new ConcursoError(`El broker ${params.brokerId} no está dado de alta`);
  const [concurso] = await sql`SELECT estatus FROM contests WHERE id = ${params.contestId}`;
  if (!concurso) throw new ConcursoError("Concurso no encontrado");
  if (concurso.estatus === "finalizado") throw new ConcursoError("El concurso ya está finalizado: sus ganadores no cambian");
  await sql`INSERT INTO contest_exclusions (contest_id, broker_id) VALUES (${params.contestId}, ${params.brokerId}) ON CONFLICT DO NOTHING`;
  await logAudit({
    actorEmail: params.actorEmail,
    action: "exclude_broker_from_contest",
    entityType: "contest",
    entityId: String(params.contestId),
    metadata: { brokerId: params.brokerId },
  });
}

export async function includeBrokerInContest(params: { contestId: number; brokerId: string; actorEmail: string }): Promise<void> {
  const [concurso] = await sql`SELECT estatus FROM contests WHERE id = ${params.contestId}`;
  if (!concurso) throw new ConcursoError("Concurso no encontrado");
  if (concurso.estatus === "finalizado") throw new ConcursoError("El concurso ya está finalizado: sus ganadores no cambian");
  await sql`DELETE FROM contest_exclusions WHERE contest_id = ${params.contestId} AND broker_id = ${params.brokerId}`;
  await logAudit({
    actorEmail: params.actorEmail,
    action: "include_broker_in_contest",
    entityType: "contest",
    entityId: String(params.contestId),
    metadata: { brokerId: params.brokerId },
  });
}

async function colocacionesDelPeriodo(c: Pick<Contest, "fechaInicio" | "fechaFin">): Promise<ColocacionDeConcurso[]> {
  const rows = await sql`
    SELECT broker_id, fecha, monto FROM broker_colocaciones
    WHERE fecha BETWEEN ${c.fechaInicio} AND ${c.fechaFin}
  `;
  return rows.map((r) => ({
    brokerId: r.broker_id as string,
    fecha: toDateString(r.fecha),
    monto: Number(r.monto),
  }));
}

/** La tabla del concurso con la colocación de su periodo (no el histórico). */
export async function posicionesDelConcurso(c: Contest): Promise<PosicionConcurso[]> {
  const [colocaciones, nombres, excluidos] = await Promise.all([
    colocacionesDelPeriodo(c),
    nombresDeBrokers(),
    getContestExclusions(c.id),
  ]);
  return posicionesDeConcurso(c, colocaciones, nombres, excluidos);
}

export interface Ganador {
  premio: number;
  brokerId: string;
  nombre: string;
  valor: number;
  monto: number;
  operaciones: number;
}

/** Ganadores fijados al finalizar cada concurso. */
export async function listWinners(contestIds: number[]): Promise<Map<number, Ganador[]>> {
  const porConcurso = new Map<number, Ganador[]>();
  if (contestIds.length === 0) return porConcurso;
  const rows = await sql`
    SELECT * FROM contest_winners WHERE contest_id = ANY(${sql.array(contestIds)}::int[]) ORDER BY contest_id, premio
  `;
  for (const r of rows) {
    const lista = porConcurso.get(r.contest_id as number) ?? [];
    lista.push({
      premio: r.premio as number,
      brokerId: r.broker_id as string,
      nombre: r.nombre as string,
      valor: Number(r.valor),
      monto: Number(r.monto),
      operaciones: r.operaciones as number,
    });
    porConcurso.set(r.contest_id as number, lista);
  }
  return porConcurso;
}

/**
 * Cierra el concurso: calcula la tabla con la colocación de su periodo, guarda a
 * los ganadores y lo marca finalizado. Después ya no cambia aunque se corrija la
 * colocación. Si ya estaba finalizado no hace nada.
 */
export async function finalizarConcurso(params: { id: number; actorEmail: string }): Promise<{ ganadores: number }> {
  const contest = await getContest(params.id);
  if (!contest) throw new ConcursoError("Concurso no encontrado");
  if (contest.estatus === "finalizado") return { ganadores: (await listWinners([contest.id])).get(contest.id)?.length ?? 0 };

  const ganadores = ganadoresDeConcurso(await posicionesDelConcurso(contest));
  await transaccion(async (tx) => {
    const [bloqueado] = await tx`SELECT estatus FROM contests WHERE id = ${contest.id} FOR UPDATE`;
    if (!bloqueado || bloqueado.estatus === "finalizado") return;
    await tx`DELETE FROM contest_winners WHERE contest_id = ${contest.id}`;
    if (ganadores.length > 0) {
      const filas = ganadores.map((g) => ({
        contest_id: contest.id,
        premio: g.premio,
        broker_id: g.brokerId,
        nombre: g.nombre,
        valor: g.valor,
        monto: g.monto,
        operaciones: g.operaciones,
      }));
      await tx`INSERT INTO contest_winners ${tx(filas, "contest_id", "premio", "broker_id", "nombre", "valor", "monto", "operaciones")}`;
    }
    await tx`UPDATE contests SET estatus = 'finalizado', finalizado_at = now() WHERE id = ${contest.id}`;
  });
  await logAudit({
    actorEmail: params.actorEmail,
    action: "finalize_contest",
    entityType: "contest",
    entityId: String(contest.id),
    metadata: { ganadores: ganadores.map((g) => g.brokerId) },
  });
  return { ganadores: ganadores.length };
}
