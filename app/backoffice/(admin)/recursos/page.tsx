import { listResources } from "@/lib/db/resources";
import Card from "@/components/ui/Card";
import Badge from "@/components/ui/Badge";
import EmptyState from "@/components/ui/EmptyState";
import { createResourceAction, setResourceStatusAction } from "./actions";

export default async function BackofficeRecursosPage() {
  let resources: Awaited<ReturnType<typeof listResources>> = [];
  let loadError = false;
  try {
    resources = await listResources();
  } catch {
    loadError = true;
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Recursos (CMS)</h1>

      <Card>
        <p className="mb-3 text-sm font-medium text-finbra-gray">Nuevo recurso</p>
        <form action={createResourceAction} className="grid gap-3 sm:grid-cols-4">
          <input name="titulo" required placeholder="Título" className="rounded-lg border border-black/10 px-3 py-2 text-sm sm:col-span-2" />
          <input name="categoria" required placeholder="Categoría (ej. Material Comercial)" className="rounded-lg border border-black/10 px-3 py-2 text-sm" />
          <input name="tipo" required placeholder="Tipo (PDF, Video, Link…)" className="rounded-lg border border-black/10 px-3 py-2 text-sm" />
          <input name="url" placeholder="URL (opcional)" className="rounded-lg border border-black/10 px-3 py-2 text-sm sm:col-span-2" />
          <input name="contenido" placeholder="Contenido/notas (opcional)" className="rounded-lg border border-black/10 px-3 py-2 text-sm sm:col-span-2" />
          <button type="submit" className="rounded-lg bg-finbra-purple px-4 py-2 text-sm font-bold text-white sm:col-span-1">
            Crear (borrador)
          </button>
        </form>
      </Card>

      {loadError ? (
        <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-red-700">No pudimos cargar los recursos.</div>
      ) : resources.length === 0 ? (
        <EmptyState title="Sin recursos todavía" description="Crea el primero arriba." />
      ) : (
        <Card className="overflow-x-auto p-0">
          <table className="w-full min-w-[560px] text-left text-sm">
            <thead>
              <tr className="border-b border-black/5 text-xs uppercase tracking-wide text-finbra-gray">
                <th className="px-6 py-3">Título</th>
                <th className="px-6 py-3">Categoría</th>
                <th className="px-6 py-3">Tipo</th>
                <th className="px-6 py-3">Estatus</th>
                <th className="px-6 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {resources.map((r) => (
                <tr key={r.id} className="border-b border-black/5 last:border-0">
                  <td className="px-6 py-4">{r.titulo}</td>
                  <td className="px-6 py-4">{r.categoria}</td>
                  <td className="px-6 py-4">
                    <Badge variant="gray">{r.tipo}</Badge>
                  </td>
                  <td className="px-6 py-4">
                    <Badge variant={r.estatus === "publicado" ? "success" : "warning"}>{r.estatus}</Badge>
                  </td>
                  <td className="px-6 py-4 text-right">
                    <form action={setResourceStatusAction.bind(null, r.id, r.estatus === "publicado" ? "borrador" : "publicado")}>
                      <button type="submit" className="text-sm font-semibold text-finbra-purple hover:underline">
                        {r.estatus === "publicado" ? "Despublicar" : "Publicar"}
                      </button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
