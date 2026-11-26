// Roles del backoffice y las reglas para cambiarlos en Usuarios. Funciones
// puras, sin base de datos, para probarlas con `node --test`.

export type Rol = "super_admin" | "comercial" | "finanzas";

export const ROLES: { value: Rol; label: string }[] = [
  { value: "comercial", label: "Comercial" },
  { value: "finanzas", label: "Finanzas" },
  { value: "super_admin", label: "Super Admin" },
];

export const etiquetaRol = (r: string) => ROLES.find((x) => x.value === r)?.label ?? r;
export const esRol = (r: unknown): r is Rol => typeof r === "string" && ROLES.some((x) => x.value === r);

interface UsuarioParaRegla {
  email: string;
  role: string;
  activo: boolean;
}

/** Super Admins activos que quedarían si `email` deja de serlo. */
function quedanSuperAdmins(usuarios: UsuarioParaRegla[], email: string): number {
  return usuarios.filter((u) => u.activo && u.role === "super_admin" && u.email !== email).length;
}

/**
 * Si se puede cambiar el rol: nadie se quita a sí mismo el Super Admin (se
 * quedaría sin poder deshacerlo) y siempre queda al menos un Super Admin activo.
 * null si se puede; si no, el porqué.
 */
export function errorCambioRol(p: { actor: string; email: string; nuevo: unknown; usuarios: UsuarioParaRegla[] }): string | null {
  if (!esRol(p.nuevo)) return "Ese rol no existe.";
  const u = p.usuarios.find((x) => x.email === p.email);
  if (!u) return "Ese usuario no existe.";
  if (u.role === p.nuevo) return null;
  if (u.role === "super_admin") {
    if (p.email === p.actor) return "No puedes quitarte a ti mismo el rol de Super Admin. Pídeselo a otro Super Admin.";
    if (u.activo && quedanSuperAdmins(p.usuarios, p.email) === 0) return "Debe quedar al menos un Super Admin activo.";
  }
  return null;
}

/** Si se puede desactivar: nadie se desactiva a sí mismo y siempre queda un Super Admin activo. */
export function errorDesactivar(p: { actor: string; email: string; usuarios: UsuarioParaRegla[] }): string | null {
  const u = p.usuarios.find((x) => x.email === p.email);
  if (!u) return "Ese usuario no existe.";
  if (p.email === p.actor) return "No puedes desactivarte a ti mismo.";
  if (u.role === "super_admin" && u.activo && quedanSuperAdmins(p.usuarios, p.email) === 0) return "Debe quedar al menos un Super Admin activo.";
  return null;
}
