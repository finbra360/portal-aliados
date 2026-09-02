import { listContests } from "@/lib/db/contests";
import { formatCurrency } from "@/lib/format";
import Card from "@/components/ui/Card";
import Badge from "@/components/ui/Badge";
import EmptyState from "@/components/ui/EmptyState";
import { IconTrophy } from "@/components/ui/icons";
import { createContestAction, setContestStatusAction } from "./actions";

const STATUS_VARIANT = {
  borrador: "gray",
  activo: "success",
  pausado: "warning",
  finalizado: "purple",
} as const;

export default async function BackofficeConcursosPage() {
  let contests: Awaited<ReturnType<typeof listContests>> = [];
  let loadError = false;
  try {
    contests = await listContests();
  } catch {
    loadError = true;
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Concursos</h1>

      <Card>
        <p className="mb-3 text-sm font-medium text-finbra-gray">Crear concurso</p>
        <form action={createContestAction} className="grid gap-3 sm:grid-cols-3">
          <input name="nombre" required placeholder="Nombre" className="rounded-lg border border-black/10 px-3 py-2 text-sm sm:col-span-2" />
          <select name="criterio" className="rounded-lg border border-black/10 px-3 py-2 text-sm">
            <option value="monto">Monto colocado</option>
            <option value="operaciones"># Operaciones</option>
          </select>
          <input name="descripcion" placeholder="Descripción (opcional)" className="rounded-lg border border-black/10 px-3 py-2 text-sm sm:col-span-3" />
          <label className="text-xs text-finbra-gray">
            Inicio
            <input name="fechaInicio" type="date" required className="mt-1 w-full rounded-lg border border-black/10 px-3 py-2 text-sm" />
          </label>
          <label className="text-xs text-finbra-gray">
            Fin
            <input name="fechaFin" type="date" required className="mt-1 w-full rounded-lg border border-black/10 px-3 py-2 text-sm" />
          </label>
          <label className="text-xs text-finbra-gray">
            # Ganadores
            <input name="numGanadores" type="number" min={1} defaultValue={1} className="mt-1 w-full rounded-lg border border-black/10 px-3 py-2 text-sm" />
          </label>
          <input name="premio" required placeholder="Premio" className="rounded-lg border border-black/10 px-3 py-2 text-sm sm:col-span-2" />
          <button type="submit" className="rounded-lg bg-finbra-purple px-4 py-2 text-sm font-bold text-white">
            Crear (borrador)
          </button>
        </form>
      </Card>

      {loadError ? (
        <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-red-700">No pudimos cargar los concursos.</div>
      ) : contests.length === 0 ? (
        <EmptyState icon={<IconTrophy />} title="Sin concursos todavía" description="Crea el primero arriba." />
      ) : (
        <div className="space-y-3">
          {contests.map((c) => (
            <Card key={c.id} className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <p className="font-semibold">{c.nombre}</p>
                  <Badge variant={STATUS_VARIANT[c.estatus]}>{c.estatus}</Badge>
                </div>
                <p className="text-xs text-finbra-gray">
                  {c.fechaInicio} → {c.fechaFin} · {c.criterio} · Premio: {c.premio} · {c.numGanadores} ganador(es)
                </p>
                {c.metaObjetivo && <p className="text-xs text-finbra-gray">Meta: {formatCurrency(c.metaObjetivo)}</p>}
              </div>
              <div className="flex gap-2">
                {c.estatus !== "activo" && c.estatus !== "finalizado" && (
                  <form action={setContestStatusAction.bind(null, c.id, "activo")}>
                    <button type="submit" className="rounded-lg border border-emerald-300 px-3 py-1.5 text-xs font-semibold text-emerald-700">
                      Activar
                    </button>
                  </form>
                )}
                {c.estatus === "activo" && (
                  <form action={setContestStatusAction.bind(null, c.id, "pausado")}>
                    <button type="submit" className="rounded-lg border border-amber-300 px-3 py-1.5 text-xs font-semibold text-amber-700">
                      Pausar
                    </button>
                  </form>
                )}
                {c.estatus !== "finalizado" && (
                  <form action={setContestStatusAction.bind(null, c.id, "finalizado")}>
                    <button type="submit" className="rounded-lg border border-black/10 px-3 py-1.5 text-xs font-semibold text-finbra-gray">
                      Finalizar
                    </button>
                  </form>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}

      <p className="text-xs text-finbra-gray">
        Nota: el standing (posiciones) de un concurso hoy se calcula con el ranking histórico general de la
        plataforma — todavía no está acotado exactamente al periodo del concurso. Eso requiere extender el
        webhook de leaderboard para aceptar rango de fechas (Fase 2).
      </p>
    </div>
  );
}
