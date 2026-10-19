import Link from "next/link";
import { listContests } from "@/lib/db/contests";
import { etapaDelPeriodo } from "@/lib/concursos";
import { fechaMexico } from "@/lib/collections/rules";
import { getAdminSession } from "@/lib/get-admin-session";
import { hasRole } from "@/lib/rbac";
import { formatFecha, formatValorConcurso } from "@/lib/format";
import Card from "@/components/ui/Card";
import Badge from "@/components/ui/Badge";
import EmptyState from "@/components/ui/EmptyState";
import { IconTrophy } from "@/components/ui/icons";
import NuevoConcurso from "./NuevoConcurso";
import { activarConcursoAction } from "./actions";
import { CONCURSOS_EDITAN } from "./roles";

const STATUS_VARIANT = {
  borrador: "gray",
  activo: "success",
  pausado: "warning",
  finalizado: "purple",
} as const;

export default async function BackofficeConcursosPage() {
  const puedeEditar = hasRole(await getAdminSession(), CONCURSOS_EDITAN);
  const hoy = fechaMexico();

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

      {puedeEditar && (
        <Card>
          <p className="mb-3 text-sm font-medium text-finbra-gray">Crear concurso</p>
          <NuevoConcurso />
        </Card>
      )}

      {loadError ? (
        <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-red-700">No pudimos cargar los concursos.</div>
      ) : contests.length === 0 ? (
        <EmptyState icon={<IconTrophy />} title="Sin concursos todavía" description="Crea el primero arriba." />
      ) : (
        <div className="space-y-3">
          {contests.map((c) => {
            const etapa = etapaDelPeriodo(c, hoy);
            const pendienteDeCierre = c.estatus !== "finalizado" && c.estatus !== "borrador" && etapa === "terminado";
            return (
              <Card key={c.id} className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Link href={`/backoffice/concursos/${c.id}`} className="font-semibold text-finbra-purple hover:underline">
                      {c.nombre}
                    </Link>
                    <Badge variant={STATUS_VARIANT[c.estatus]}>{c.estatus}</Badge>
                    {pendienteDeCierre && <Badge variant="warning">Periodo terminado: falta finalizar</Badge>}
                  </div>
                  <p className="text-xs text-finbra-gray">
                    {formatFecha(c.fechaInicio)} → {formatFecha(c.fechaFin)} · {c.criterio === "monto" ? "por monto" : "por operaciones"} · Premio: {c.premio} · {c.numGanadores} ganador(es)
                  </p>
                  {c.metaObjetivo !== null && (
                    <p className="text-xs text-finbra-gray">Meta para ganar: {formatValorConcurso(c.criterio, c.metaObjetivo)}</p>
                  )}
                </div>
                <div className="flex flex-wrap gap-2">
                  <Link href={`/backoffice/concursos/${c.id}`} className="rounded-lg border border-black/10 px-3 py-1.5 text-xs font-semibold text-finbra-purple-700 hover:bg-finbra-purple/5">
                    Ver tabla
                  </Link>
                  {puedeEditar && c.estatus !== "activo" && c.estatus !== "finalizado" && (
                    <form action={activarConcursoAction.bind(null, c.id, "activo")}>
                      <button type="submit" className="rounded-lg border border-emerald-300 px-3 py-1.5 text-xs font-semibold text-emerald-700">
                        Activar
                      </button>
                    </form>
                  )}
                  {puedeEditar && c.estatus === "activo" && (
                    <form action={activarConcursoAction.bind(null, c.id, "pausado")}>
                      <button type="submit" className="rounded-lg border border-amber-300 px-3 py-1.5 text-xs font-semibold text-amber-700">
                        Pausar
                      </button>
                    </form>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <p className="text-xs text-finbra-gray">
        La tabla de cada concurso cuenta solo la colocación con fecha dentro de su periodo. Con meta, solo ganan quienes la
        alcanzan; en un empate gana quien llegó primero. Finalizar fija a los ganadores.
      </p>
    </div>
  );
}
