// Permisos del backoffice por capacidad: qué puede hacer cada rol, en un solo
// lugar. Las páginas y acciones preguntan por la capacidad («¿puede operar
// cobranza?»), no por una lista de roles, para que cambiar quién hace qué sea
// editar este mapa y nada más.
//
// Como en rbac.ts: se revisa SIEMPRE en el servidor (página y acción). Ocultar
// un botón es solo para no ofrecer lo que no se puede hacer.
//
// Por ahora cubre clientes, cartera y cobranza; los demás módulos siguen con sus listas
// de roles (brokers/roles.ts, credit-health/roles.ts…) hasta que se migren.

import type { AdminRole } from "./db/admin-users.ts";
import type { AdminSessionPayload } from "./admin-auth.ts";
import { ForbiddenError } from "./rbac.ts";

export type Permiso = "cartera.ver" | "clientes.editar" | "cobranza.operar" | "cobranza.configurar";

export const PERMISOS: Record<Permiso, { descripcion: string; roles: readonly AdminRole[] }> = {
  "cartera.ver": {
    descripcion:
      "Ver clientes, créditos, saldos, semáforo de pago, cola de trabajo y conversaciones de WhatsApp, sin cambiar nada. Comercial lo tiene desde el 2026-11-05 (decisión de Santiago).",
    roles: ["super_admin", "finanzas", "comercial"],
  },
  "clientes.editar": {
    descripcion: "Editar los datos de la empresa en Clientes: nombre, razón social, RFC, industria, ejecutivo y notas. No toca nada de SIAC.",
    roles: ["super_admin", "finanzas", "comercial"],
  },
  "cobranza.operar": {
    descripcion:
      "Registrar gestiones y promesas, editar contactos, cuenta de pago, etapa y pausa, consultar el saldo al día a SIAC, contestar por WhatsApp y administrar las cuentas de pago.",
    roles: ["super_admin", "finanzas"],
  },
  "cobranza.configurar": {
    descripcion: "Prender y apagar los envíos automáticos, activar plantillas, enviar a mano y mandar el reporte a Slack.",
    roles: ["super_admin"],
  },
};

/** El rol tiene el permiso. Para cuando solo se conoce el rol (menú, pendientes de Inicio). */
export function rolPuede(role: AdminRole | null | undefined, permiso: Permiso): boolean {
  return !!role && PERMISOS[permiso].roles.includes(role);
}

/** Hay sesión y su rol tiene el permiso. */
export function puede(session: AdminSessionPayload | null, permiso: Permiso): session is AdminSessionPayload {
  return !!session && rolPuede(session.role, permiso);
}

/** Igual que `puede`, pero lanza ForbiddenError: para el inicio de cada server action. */
export function requierePermiso(session: AdminSessionPayload | null, permiso: Permiso): AdminSessionPayload {
  if (!session) throw new ForbiddenError("Sesión de administrador requerida");
  if (!rolPuede(session.role, permiso)) throw new ForbiddenError("Tu rol solo puede consultar esta sección; no puede hacer cambios aquí");
  return session;
}
