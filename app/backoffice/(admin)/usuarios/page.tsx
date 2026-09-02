import { listAdminUsers } from "@/lib/db/admin-users";
import { getAdminSession } from "@/lib/get-admin-session";
import Card from "@/components/ui/Card";
import Badge from "@/components/ui/Badge";
import { createAdminUserAction, toggleAdminUserActiveAction } from "./actions";

export default async function BackofficeUsuariosPage() {
  const session = await getAdminSession();
  let users: Awaited<ReturnType<typeof listAdminUsers>> = [];
  let loadError = false;
  try {
    users = await listAdminUsers();
  } catch {
    loadError = true;
  }

  const isSuperAdmin = session?.role === "super_admin";

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Usuarios internos</h1>

      {isSuperAdmin && (
        <Card>
          <p className="mb-3 text-sm font-medium text-finbra-gray">Dar de alta usuario</p>
          <form action={createAdminUserAction} className="grid gap-3 sm:grid-cols-4">
            <input name="nombre" required placeholder="Nombre" className="rounded-lg border border-black/10 px-3 py-2 text-sm" />
            <input name="email" type="email" required placeholder="email@finbra.com" className="rounded-lg border border-black/10 px-3 py-2 text-sm" />
            <select name="role" className="rounded-lg border border-black/10 px-3 py-2 text-sm">
              <option value="comercial">Comercial</option>
              <option value="finanzas">Finanzas</option>
              <option value="super_admin">Super Admin</option>
            </select>
            <button type="submit" className="rounded-lg bg-finbra-purple px-4 py-2 text-sm font-bold text-white">
              Dar de alta
            </button>
          </form>
        </Card>
      )}

      {loadError ? (
        <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-red-700">No pudimos cargar los usuarios.</div>
      ) : (
        <Card className="overflow-x-auto p-0">
          <table className="w-full min-w-[520px] text-left text-sm">
            <thead>
              <tr className="border-b border-black/5 text-xs uppercase tracking-wide text-finbra-gray">
                <th className="px-6 py-3">Nombre</th>
                <th className="px-6 py-3">Email</th>
                <th className="px-6 py-3">Rol</th>
                <th className="px-6 py-3">Estatus</th>
                {isSuperAdmin && <th className="px-6 py-3"></th>}
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className="border-b border-black/5 last:border-0">
                  <td className="px-6 py-4">{u.nombre}</td>
                  <td className="px-6 py-4 text-finbra-gray">{u.email}</td>
                  <td className="px-6 py-4">
                    <Badge>{u.role}</Badge>
                  </td>
                  <td className="px-6 py-4">
                    <Badge variant={u.activo ? "success" : "warning"}>{u.activo ? "activo" : "inactivo"}</Badge>
                  </td>
                  {isSuperAdmin && (
                    <td className="px-6 py-4 text-right">
                      <form action={toggleAdminUserActiveAction.bind(null, u.email, !u.activo)}>
                        <button type="submit" className="text-sm font-semibold text-finbra-purple hover:underline">
                          {u.activo ? "Desactivar" : "Reactivar"}
                        </button>
                      </form>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
