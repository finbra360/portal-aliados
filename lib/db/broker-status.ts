import { sql } from "@/lib/db";
import { logAudit } from "./audit";

export type BrokerEstatus = "activo" | "suspendido";

/**
 * Overlay sobre el roster del Sheet. No se aplica todavía en el login del
 * portal (broker-portal-request-code) -- ver Fase 2 del plan del backoffice.
 */
export async function getBrokerStatusMap(): Promise<Record<string, BrokerEstatus>> {
  const rows = await sql`SELECT broker_id, estatus FROM broker_status`;
  const map: Record<string, BrokerEstatus> = {};
  for (const r of rows) {
    map[r.broker_id as string] = r.estatus as BrokerEstatus;
  }
  return map;
}

export async function setBrokerStatus(params: { brokerId: string; estatus: BrokerEstatus; actorEmail: string }): Promise<void> {
  await sql`
    INSERT INTO broker_status (broker_id, estatus, updated_by)
    VALUES (${params.brokerId}, ${params.estatus}, ${params.actorEmail})
    ON CONFLICT (broker_id) DO UPDATE SET estatus = ${params.estatus}, updated_by = ${params.actorEmail}, updated_at = now()
  `;
  await logAudit({
    actorEmail: params.actorEmail,
    action: params.estatus === "suspendido" ? "suspend_broker" : "activate_broker",
    entityType: "broker",
    entityId: params.brokerId,
  });
}
