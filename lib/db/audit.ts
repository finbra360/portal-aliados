import { sql } from "@/lib/db";

export async function logAudit(params: {
  actorEmail: string;
  action: string;
  entityType: string;
  entityId?: string;
  metadata?: Record<string, unknown>;
}) {
  await sql`
    INSERT INTO audit_log (actor_email, action, entity_type, entity_id, metadata)
    VALUES (
      ${params.actorEmail},
      ${params.action},
      ${params.entityType},
      ${params.entityId ?? null},
      ${params.metadata ? JSON.stringify(params.metadata) : null}::jsonb
    )
  `;
}

export interface AuditLogEntry {
  id: number;
  actorEmail: string;
  action: string;
  entityType: string;
  entityId: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

export async function listAuditLog(filters: { actorEmail?: string; entityType?: string } = {}): Promise<AuditLogEntry[]> {
  const rows = await sql`
    SELECT id, actor_email, action, entity_type, entity_id, metadata, created_at
    FROM audit_log
    WHERE (${filters.actorEmail ?? null}::text IS NULL OR actor_email = ${filters.actorEmail ?? null})
      AND (${filters.entityType ?? null}::text IS NULL OR entity_type = ${filters.entityType ?? null})
    ORDER BY created_at DESC
    LIMIT 200
  `;
  return rows.map((r) => ({
    id: r.id,
    actorEmail: r.actor_email,
    action: r.action,
    entityType: r.entity_type,
    entityId: r.entity_id,
    metadata: r.metadata,
    createdAt: (r.created_at as Date).toISOString(),
  }));
}
