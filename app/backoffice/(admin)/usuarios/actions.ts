"use server";

import { revalidatePath } from "next/cache";
import { getAdminSession } from "@/lib/get-admin-session";
import { requireRole } from "@/lib/rbac";
import { createAdminUser, setAdminUserActive, type AdminRole } from "@/lib/db/admin-users";

export async function createAdminUserAction(formData: FormData) {
  const session = await getAdminSession();
  const admin = requireRole(session, ["super_admin"]);

  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const nombre = String(formData.get("nombre") ?? "").trim();
  const role = String(formData.get("role") ?? "comercial") as AdminRole;

  if (!email || !nombre) {
    return;
  }

  await createAdminUser({ email, nombre, role, actorEmail: admin.email });
  revalidatePath("/backoffice/usuarios");
}

export async function toggleAdminUserActiveAction(email: string, activo: boolean) {
  const session = await getAdminSession();
  const admin = requireRole(session, ["super_admin"]);
  await setAdminUserActive({ email, activo, actorEmail: admin.email });
  revalidatePath("/backoffice/usuarios");
}
