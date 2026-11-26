import { cache } from "react";
import { cookies } from "next/headers";
import { verifyAdminSession, ADMIN_SESSION_COOKIE_NAME, type AdminSessionPayload } from "./admin-auth";
import { findAdminByEmail } from "./db/admin-users";
import { codigoDeError } from "./collections/errors";

/**
 * La sesión del backoffice. El rol y el nombre salen de admin_users en cada
 * petición (no del token), así un cambio de rol o una baja en Usuarios aplica
 * de inmediato; un usuario desactivado ya no tiene sesión. Si la base no
 * contesta, se usa lo del token para no dejar a todos fuera.
 */
export const getAdminSession = cache(async (): Promise<AdminSessionPayload | null> => {
  const cookieStore = await cookies();
  const token = cookieStore.get(ADMIN_SESSION_COOKIE_NAME)?.value;
  const payload = token ? await verifyAdminSession(token) : null;
  if (!payload) return null;
  try {
    const u = await findAdminByEmail(payload.email);
    return u ? { email: payload.email, nombre: u.nombre, role: u.role } : null;
  } catch (e) {
    codigoDeError("sesión: leer el rol de admin_users", e);
    return payload;
  }
});
