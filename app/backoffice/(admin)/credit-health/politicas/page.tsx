import Card from "@/components/ui/Card";
import EmptyState from "@/components/ui/EmptyState";
import { getAdminSession } from "@/lib/get-admin-session";
import { hasRole } from "@/lib/rbac";
import { CH_EDITAN_POLITICAS, CH_VEN } from "@/lib/credit-health/roles";
import { listarVersiones, politicaActiva } from "@/lib/credit-health/politicas";
import { activarPoliticaAction } from "../actions";
import { ErrorCarga, fechaHora } from "../ui";
import EditorPolitica from "./EditorPolitica";

const ESTADO: Record<string, { texto: string; clase: string }> = {
  active: { texto: "Activa", clase: "bg-emerald-100 text-emerald-700" },
  draft: { texto: "Borrador", clase: "bg-amber-100 text-amber-800" },
  archived: { texto: "Archivada", clase: "bg-black/5 text-finbra-gray" },
};

export default async function PoliticasPage() {
  const session = await getAdminSession();
  if (!hasRole(session, CH_VEN)) return null;
  const puedeEditar = hasRole(session, CH_EDITAN_POLITICAS);

  let datos: { activa: Awaited<ReturnType<typeof politicaActiva>>; versiones: Awaited<ReturnType<typeof listarVersiones>> } | null = null;
  try {
    const [activa, versiones] = await Promise.all([politicaActiva(), listarVersiones()]);
    datos = { activa, versiones };
  } catch (e) {
    console.error("[credit-health] políticas", e instanceof Error ? e.message : e);
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Políticas de Credit Health</h1>
        <p className="mt-1 text-sm text-finbra-gray">
          Parámetros del diagnóstico. Los cambios se guardan como borrador y un Super Admin los activa; cada prospecto guarda la versión con la que se evaluó.
        </p>
      </div>
      {datos?.activa?.config.pendingApproval?.length ? (
        <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          La política activa tiene parámetros marcados como <strong>pendientes</strong>. Cuando el comité los apruebe, marca la casilla de aprobación al final del editor, guarda y activa la versión.
        </p>
      ) : null}

      {!datos ? (
        <ErrorCarga texto="No pudimos cargar las políticas." />
      ) : !datos.activa ? (
        <EmptyState title="Todavía no hay una política activa" description="Credit Health crea la política de referencia en su primer arranque." />
      ) : (
        <div className="grid gap-6 xl:grid-cols-[1fr_340px]">
          <Card>
            <h2 className="font-semibold">Editar a partir de la versión activa (v{datos.activa.version})</h2>
            <p className="mb-5 text-sm text-finbra-gray">{datos.activa.label}</p>
            <EditorPolitica inicial={datos.activa.config} puedeEditar={puedeEditar} />
          </Card>
          <Card className="h-fit">
            <h2 className="font-semibold">Versiones</h2>
            <ul className="mt-3 divide-y divide-black/5">
              {datos.versiones.map((v) => (
                <li key={v.id} className="py-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-semibold">v{v.version}</p>
                    <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${ESTADO[v.status]?.clase ?? ""}`}>{ESTADO[v.status]?.texto ?? v.status}</span>
                  </div>
                  <p className="text-xs text-finbra-gray">{v.label}</p>
                  <p className="mt-0.5 text-[11px] text-finbra-gray">
                    {v.createdBy} · {fechaHora(v.createdAt)}
                    {v.activatedAt ? ` · activó ${v.activatedBy}` : ""}
                  </p>
                  {v.notes ? <p className="mt-1 text-xs">{v.notes}</p> : null}
                  {v.status === "draft" && puedeEditar ? (
                    <form action={activarPoliticaAction} className="mt-2">
                      <input type="hidden" name="id" value={v.id} />
                      <button type="submit" className="rounded-lg border border-black/10 bg-white px-3 py-1.5 text-xs font-semibold hover:border-finbra-purple/40">
                        Activar esta versión
                      </button>
                    </form>
                  ) : null}
                </li>
              ))}
            </ul>
          </Card>
        </div>
      )}
    </div>
  );
}
