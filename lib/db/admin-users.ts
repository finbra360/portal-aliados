import { sql } from "@/lib/db";
import { logAudit } from "./audit";

export type AdminRole = "super_admin" | "comercial" | "finanzas";

export interface AdminUser {
  id: number;
  email: string;
  nombre: string;
  role: AdminRole;
  activo: boolean;
  createdAt: string;
}

function mapRow(r: Record<string, unknown>): AdminUser {
  return {
    id: r.id as number,
    email: r.email as string,
    nombre: r.nombre as string,
    role: r.role as AdminRole,
    activo: r.activo as boolean,
    createdAt: (r.created_at as Date).toISOString(),
  };
}

export async function findAdminByEmail(email: string): Promise<AdminUser | null> {
  const rows = await sql`SELECT * FROM admin_users WHERE email = ${email} AND activo = true LIMIT 1`;
  return rows[0] ? mapRow(rows[0]) : null;
}

export async function listAdminUsers(): Promise<AdminUser[]> {
  const rows = await sql`SELECT * FROM admin_users ORDER BY created_at DESC`;
  return rows.map(mapRow);
}

export async function createAdminUser(params: {
  email: string;
  nombre: string;
  role: AdminRole;
  actorEmail: string;
}): Promise<AdminUser> {
  const rows = await sql`
    INSERT INTO admin_users (email, nombre, role)
    VALUES (${params.email}, ${params.nombre}, ${params.role})
    RETURNING *
  `;
  await logAudit({
    actorEmail: params.actorEmail,
    action: "create_admin_user",
    entityType: "admin_user",
    entityId: params.email,
    metadata: { role: params.role },
  });
  return mapRow(rows[0]);
}

export async function setAdminUserRole(params: { email: string; role: AdminRole; actorEmail: string }): Promise<void> {
  await sql`UPDATE admin_users SET role = ${params.role} WHERE email = ${params.email}`;
  await logAudit({
    actorEmail: params.actorEmail,
    action: "change_admin_role",
    entityType: "admin_user",
    entityId: params.email,
    metadata: { newRole: params.role },
  });
}

export async function setAdminUserActive(params: { email: string; activo: boolean; actorEmail: string }): Promise<void> {
  await sql`UPDATE admin_users SET activo = ${params.activo} WHERE email = ${params.email}`;
  await logAudit({
    actorEmail: params.actorEmail,
    action: params.activo ? "activate_admin_user" : "deactivate_admin_user",
    entityType: "admin_user",
    entityId: params.email,
  });
}
