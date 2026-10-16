import { listAnnouncements } from "@/lib/db/announcements";
import { estadoDeAnuncio, type EstadoAnuncio } from "@/lib/anuncios";
import { getAdminSession } from "@/lib/get-admin-session";
import { hasRole } from "@/lib/rbac";
import { formatFechaHora } from "@/lib/format";
import Card from "@/components/ui/Card";
import Badge from "@/components/ui/Badge";
import EmptyState from "@/components/ui/EmptyState";
import NuevoAnuncio from "./NuevoAnuncio";
import { terminarAnuncioAction } from "./actions";
import { COMUNICACIONES_EDITAN } from "./roles";

const ESTADO: Record<EstadoAnuncio, { texto: string; variante: "success" | "warning" | "gray" }> = {
  vigente: { texto: "Vigente", variante: "success" },
  programado: { texto: "Programado", variante: "warning" },
  terminado: { texto: "Terminado", variante: "gray" },
};

export default async function BackofficeComunicacionesPage() {
  const puedeEditar = hasRole(await getAdminSession(), COMUNICACIONES_EDITAN);

  let anuncios: Awaited<ReturnType<typeof listAnnouncements>>["anuncios"] = [];
  let ahora = new Date().toISOString();
  let loadError = false;
  try {
    ({ anuncios, ahora } = await listAnnouncements());
  } catch {
    loadError = true;
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Comunicaciones</h1>

      {puedeEditar && (
        <Card>
          <p className="mb-3 text-sm font-medium text-finbra-gray">Nuevo anuncio para los brokers</p>
          <NuevoAnuncio />
        </Card>
      )}

      {loadError ? (
        <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-red-700">No pudimos cargar los anuncios.</div>
      ) : anuncios.length === 0 ? (
        <EmptyState title="Sin anuncios todavía" description="Los anuncios que publiques aparecen en las Novedades del portal de cada broker." />
      ) : (
        <Card className="overflow-x-auto p-0">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead>
              <tr className="border-b border-black/5 text-xs uppercase tracking-wide text-finbra-gray">
                <th className="px-6 py-3">Anuncio</th>
                <th className="px-6 py-3">Para</th>
                <th className="px-6 py-3">Publicado</th>
                <th className="px-6 py-3">Leído por</th>
                <th className="px-6 py-3">Estado</th>
                <th className="px-6 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {anuncios.map((a) => {
                const estado = estadoDeAnuncio(a, ahora);
                return (
                  <tr key={a.id} className="border-b border-black/5 align-top last:border-0">
                    <td className="max-w-sm px-6 py-4">
                      <p className="font-semibold">{a.titulo}</p>
                      <p className="mt-1 text-xs text-finbra-gray">{a.mensaje}</p>
                      {a.ctaUrl && (
                        <p className="mt-1 text-xs text-finbra-purple">
                          {a.ctaTexto} → {a.ctaUrl}
                        </p>
                      )}
                    </td>
                    <td className="px-6 py-4">
                      {a.audiencia.tipo === "todos" ? "Todos" : `${a.audiencia.ids.length} broker(s): ${a.audiencia.ids.join(", ")}`}
                    </td>
                    <td className="px-6 py-4 text-xs text-finbra-gray">
                      {formatFechaHora(a.fechaPublicacion)}
                      {a.fechaExpiracion && <span className="block">Hasta {formatFechaHora(a.fechaExpiracion)}</span>}
                    </td>
                    <td className="px-6 py-4">{a.leidos}</td>
                    <td className="px-6 py-4">
                      <Badge variant={ESTADO[estado].variante}>{ESTADO[estado].texto}</Badge>
                    </td>
                    <td className="px-6 py-4 text-right">
                      {puedeEditar && estado !== "terminado" && (
                        <form action={terminarAnuncioAction.bind(null, a.id)}>
                          <button type="submit" className="text-sm font-semibold text-finbra-purple hover:underline">
                            Terminar
                          </button>
                        </form>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
