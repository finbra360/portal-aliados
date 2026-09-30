import type { AdminRole } from "./db/admin-users";
import type { AdminSessionPayload } from "./admin-auth";

export class ForbiddenError extends Error {
  constructor(message = "No tienes permiso para realizar esta acción") {
    super(message);
    this.name = "ForbiddenError";
  }
}

/**
 * Server-side permission check. Debe llamarse al inicio de cada route
 * handler / server action sensible -- nunca basta con ocultar un botón en
 * el frontend.
 */
export function requireRole(session: AdminSessionPayload | null, allowed: AdminRole[]): AdminSessionPayload {
  if (!session) {
    throw new ForbiddenError("Sesión de administrador requerida");
  }
  if (!allowed.includes(session.role)) {
    throw new ForbiddenError(`Esta acción requiere uno de estos roles: ${allowed.join(", ")}`);
  }
  return session;
}

/** Roles que pueden ver cobranza: saldos y datos personales de deudores. */
export const COBRANZA_ROLES: AdminRole[] = ["super_admin", "finanzas"];

export function hasRole(session: AdminSessionPayload | null, allowed: AdminRole[]): session is AdminSessionPayload {
  return !!session && allowed.includes(session.role);
}
