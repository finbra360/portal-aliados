"use server";

import { revalidatePath } from "next/cache";
import { getAdminSession } from "@/lib/get-admin-session";
import { requireRole } from "@/lib/rbac";
import { codigoDeError } from "@/lib/collections/errors";
import { errorCambioRol, errorDesactivar, esRol, etiquetaRol } from "@/lib/roles";
import { createAdminUser, listAdminUsers, setAdminUserActive, setAdminUserRole } from "@/lib/db/admin-users";

export type UsuarioResult = { ok: true; mensaje: string } | { ok: false; error: string };

export async function createAdminUserAction(formData: FormData) {
  const session = await getAdminSession();
  const admin = requireRole(session, ["super_admin"]);

  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const nombre = String(formData.get("nombre") ?? "").trim();
  const role = String(formData.get("role") ?? "comercial");

  if (!email || !nombre || !esRol(role)) {
    return;
  }

  await createAdminUser({ email, nombre, role, actorEmail: admin.email });
  revalidatePath("/backoffice/usuarios");
}

export async function toggleAdminUserActiveAction(email: string, activo: boolean): Promise<UsuarioResult> {
  const session = await getAdminSession();
  const admin = requireRole(session, ["super_admin"]);
  try {
    if (!activo) {
      const error = errorDesactivar({ actor: admin.email, email, usuarios: await listAdminUsers() });
      if (error) return { ok: false, error };
    }
    await setAdminUserActive({ email, activo, actorEmail: admin.email });
    revalidatePath("/backoffice/usuarios");
    return { ok: true, mensaje: activo ? "Usuario reactivado." : "Usuario desactivado: ya no puede entrar." };
  } catch (e) {
    return { ok: false, error: `No pudimos guardar. Intenta de nuevo. (código ${codigoDeError("usuarios: activar", e)})` };
  }
}

/** Cambia el rol de un usuario. Aplica de inmediato (la sesión lee el rol de la base). */
export async function changeAdminRoleAction(email: string, role: string): Promise<UsuarioResult> {
  const session = await getAdminSession();
  const admin = requireRole(session, ["super_admin"]);
  try {
    const usuarios = await listAdminUsers();
    const error = errorCambioRol({ actor: admin.email, email, nuevo: role, usuarios });
    if (error) return { ok: false, error };
    if (!esRol(role)) return { ok: false, error: "Ese rol no existe." };
    if (usuarios.find((u) => u.email === email)?.role === role) return { ok: true, mensaje: "Sin cambios." };
    await setAdminUserRole({ email, role, actorEmail: admin.email });
    revalidatePath("/backoffice/usuarios");
    return { ok: true, mensaje: `Ahora es ${etiquetaRol(role)}.` };
  } catch (e) {
    return { ok: false, error: `No pudimos cambiar el rol. Intenta de nuevo. (código ${codigoDeError("usuarios: cambiar rol", e)})` };
  }
}
