import { sql, transaccion } from "@/lib/db";
import { logAudit } from "./audit";
import type { OperationStatus } from "@/components/ui/StatusPill";

export interface Operation {
  id: number;
  brokerId: string;
  clienteReferencia: string;
  montoSolicitado: number;
  etapa: OperationStatus;
  notas: string | null;
  /** Lo que Finbra le dice al broker sobre esta solicitud (las notas internas no se muestran). */
  mensajeBroker: string | null;
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
    mensajeBroker: (r.mensaje_broker as string) ?? null,
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

/** Solo si la solicitud es de ese broker: un broker no ve las de otro cambiando el número en la URL. */
export async function getOperationOfBroker(id: number, brokerId: string): Promise<Operation | null> {
  const rows = await sql`SELECT * FROM operations WHERE id = ${id} AND broker_id = ${brokerId}`;
  return rows[0] ? mapRow(rows[0]) : null;
}

export async function listOperationHistory(operationId: number): Promise<{ etapa: OperationStatus; fecha: string }[]> {
  const rows = await sql`
    SELECT etapa, created_at FROM operation_history WHERE operation_id = ${operationId} ORDER BY created_at, id
  `;
  return rows.map((r) => ({ etapa: r.etapa as OperationStatus, fecha: (r.created_at as Date).toISOString() }));
}

export async function setOperationBrokerMessage(params: { id: number; mensaje: string | null; actorEmail: string }): Promise<void> {
  const rows = await sql`
    UPDATE operations SET mensaje_broker = ${params.mensaje}, updated_at = now() WHERE id = ${params.id} RETURNING id
  `;
  if (!rows[0]) throw new Error("Operación no encontrada");
  await logAudit({
    actorEmail: params.actorEmail,
    action: "update_operation_message",
    entityType: "operation",
    entityId: String(params.id),
  });
}

export async function createOperation(params: {
  brokerId: string;
  clienteReferencia: string;
  montoSolicitado: number;
  notas?: string;
  actorEmail: string;
}): Promise<Operation> {
  const operation = await transaccion(async (tx) => {
    const rows = await tx`
      INSERT INTO operations (broker_id, cliente_referencia, monto_solicitado, notas)
      VALUES (${params.brokerId}, ${params.clienteReferencia}, ${params.montoSolicitado}, ${params.notas ?? null})
      RETURNING *
    `;
    await tx`INSERT INTO operation_history (operation_id, etapa) VALUES (${rows[0].id}, ${rows[0].etapa})`;
    return mapRow(rows[0]);
  });
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
  const operation = await transaccion(async (tx) => {
    const antes = await tx`SELECT etapa FROM operations WHERE id = ${params.id} FOR UPDATE`;
    if (!antes[0]) {
      throw new Error("Operación no encontrada");
    }
    const rows = await tx`
      UPDATE operations SET etapa = ${params.etapa}, updated_at = now()
      WHERE id = ${params.id}
      RETURNING *
    `;
    // Elegir la misma etapa otra vez no es un paso nuevo.
    if (antes[0].etapa !== params.etapa) {
      await tx`INSERT INTO operation_history (operation_id, etapa) VALUES (${params.id}, ${params.etapa})`;
    }
    return mapRow(rows[0]);
  });
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
