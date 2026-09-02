import { sql } from "@/lib/db";
import { logAudit } from "./audit";

export type CommissionPaymentStatus = "generada" | "aprobada" | "pagada";

export interface CommissionPayment {
  id: number;
  brokerId: string;
  operacionFecha: string;
  operacionMonto: number;
  montoComision: number;
  estatus: CommissionPaymentStatus;
  fechaPago: string | null;
  createdAt: string;
}

function mapRow(r: Record<string, unknown>): CommissionPayment {
  return {
    id: r.id as number,
    brokerId: r.broker_id as string,
    operacionFecha: r.operacion_fecha as string,
    operacionMonto: Number(r.operacion_monto),
    montoComision: Number(r.monto_comision),
    estatus: r.estatus as CommissionPaymentStatus,
    fechaPago: r.fecha_pago ? (r.fecha_pago as Date).toISOString() : null,
    createdAt: (r.created_at as Date).toISOString(),
  };
}

export async function listCommissionPayments(brokerId?: string): Promise<CommissionPayment[]> {
  const rows = await sql`
    SELECT * FROM commission_payments
    WHERE (${brokerId ?? null}::text IS NULL OR broker_id = ${brokerId ?? null})
    ORDER BY created_at DESC
  `;
  return rows.map(mapRow);
}

/** Upsert: una fila por (broker, operación). No sobrescribe el monto una vez pagada. */
export async function upsertCommissionPayment(params: {
  brokerId: string;
  operacionFecha: string;
  operacionMonto: number;
  montoComision: number;
  actorEmail: string;
}): Promise<CommissionPayment> {
  const rows = await sql`
    INSERT INTO commission_payments (broker_id, operacion_fecha, operacion_monto, monto_comision, created_by)
    VALUES (${params.brokerId}, ${params.operacionFecha}, ${params.operacionMonto}, ${params.montoComision}, ${params.actorEmail})
    ON CONFLICT (broker_id, operacion_fecha) DO NOTHING
    RETURNING *
  `;
  if (rows[0]) return mapRow(rows[0]);
  const existing = await sql`
    SELECT * FROM commission_payments WHERE broker_id = ${params.brokerId} AND operacion_fecha = ${params.operacionFecha}
  `;
  return mapRow(existing[0]);
}

export async function setCommissionPaymentStatus(params: {
  id: number;
  estatus: CommissionPaymentStatus;
  actorEmail: string;
}): Promise<CommissionPayment> {
  const rows = await sql`
    UPDATE commission_payments
    SET estatus = ${params.estatus}, fecha_pago = ${params.estatus === "pagada" ? sql`now()` : null}
    WHERE id = ${params.id}
    RETURNING *
  `;
  if (!rows[0]) {
    throw new Error("Registro de comisión no encontrado");
  }
  await logAudit({
    actorEmail: params.actorEmail,
    action: "update_commission_status",
    entityType: "commission_payment",
    entityId: String(params.id),
    metadata: { newEstatus: params.estatus },
  });
  return mapRow(rows[0]);
}
