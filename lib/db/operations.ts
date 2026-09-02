import { sql } from "@/lib/db";
import { logAudit } from "./audit";
import type { OperationStatus } from "@/components/ui/StatusPill";

export interface Operation {
  id: number;
  brokerId: string;
  clienteReferencia: string;
  montoSolicitado: number;
  etapa: OperationStatus;
  notas: string | null;
  createdAt: string;
  updatedAt: string;
}

function mapRow(r: Record<string, unknown>): Operation {
  return {
    id: r.id as number,
    brokerId: r.broker_id as string,
    clienteReferencia: r.cliente_referencia as string,
    montoSolicitado: Number(r.monto_solicitado),
    etapa: r.etapa as OperationStatus,
    notas: (r.notas as string) ?? null,
    createdAt: (r.created_at as Date).toISOString(),
    updatedAt: (r.updated_at as Date).toISOString(),
  };
}

export interface OperationFilters {
  brokerId?: string;
  etapa?: OperationStatus;
}

export async function listOperations(filters: OperationFilters = {}): Promise<Operation[]> {
  const rows = await sql`
    SELECT * FROM operations
    WHERE (${filters.brokerId ?? null}::text IS NULL OR broker_id = ${filters.brokerId ?? null})
      AND (${filters.etapa ?? null}::text IS NULL OR etapa = ${filters.etapa ?? null})
    ORDER BY updated_at DESC
    LIMIT 500
  `;
  return rows.map(mapRow);
}

export async function getOperation(id: number): Promise<Operation | null> {
  const rows = await sql`SELECT * FROM operations WHERE id = ${id}`;
  return rows[0] ? mapRow(rows[0]) : null;
}

export async function createOperation(params: {
  brokerId: string;
  clienteReferencia: string;
  montoSolicitado: number;
  notas?: string;
  actorEmail: string;
}): Promise<Operation> {
  const rows = await sql`
    INSERT INTO operations (broker_id, cliente_referencia, monto_solicitado, notas)
    VALUES (${params.brokerId}, ${params.clienteReferencia}, ${params.montoSolicitado}, ${params.notas ?? null})
    RETURNING *
  `;
  const operation = mapRow(rows[0]);
  await logAudit({
    actorEmail: params.actorEmail,
    action: "create_operation",
    entityType: "operation",
    entityId: String(operation.id),
    metadata: { brokerId: params.brokerId, montoSolicitado: params.montoSolicitado },
  });
  return operation;
}

export async function updateOperationStage(params: {
  id: number;
  etapa: OperationStatus;
  actorEmail: string;
}): Promise<Operation> {
  const rows = await sql`
    UPDATE operations SET etapa = ${params.etapa}, updated_at = now()
    WHERE id = ${params.id}
    RETURNING *
  `;
  if (!rows[0]) {
    throw new Error("Operación no encontrada");
  }
  const operation = mapRow(rows[0]);
  await logAudit({
    actorEmail: params.actorEmail,
    action: "update_operation_stage",
    entityType: "operation",
    entityId: String(operation.id),
    metadata: { newEtapa: params.etapa },
  });
  return operation;
}

export async function countOperationsByStage(): Promise<Record<OperationStatus, number>> {
  const rows = await sql`SELECT etapa, COUNT(*)::int AS count FROM operations GROUP BY etapa`;
  const base: Record<string, number> = {
    recibida: 0,
    documentacion_pendiente: 0,
    en_analisis: 0,
    aprobada: 0,
    formalizacion: 0,
    fondeada: 0,
    rechazada: 0,
  };
  for (const r of rows) {
    base[r.etapa as string] = r.count as number;
  }
  return base as Record<OperationStatus, number>;
}
