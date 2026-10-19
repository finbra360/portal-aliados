import Link from "next/link";
import { notFound } from "next/navigation";
import { getContest, getContestExclusions, listWinners, posicionesDelConcurso } from "@/lib/db/contests";
import { nombresDeBrokers } from "@/lib/db/brokers";
import { avanceHaciaMeta, etapaDelPeriodo } from "@/lib/concursos";
import { fechaMexico } from "@/lib/collections/rules";
import { getAdminSession } from "@/lib/get-admin-session";
import { hasRole } from "@/lib/rbac";
import { formatCurrency, formatFecha, formatValorConcurso } from "@/lib/format";
import Card from "@/components/ui/Card";
import Badge from "@/components/ui/Badge";
import { ExcluirBroker, FinalizarConcurso } from "../AccionesConcurso";
import { reincorporarBrokerAction } from "../actions";
import { CONCURSOS_EDITAN } from "../roles";

export default async function BackofficeConcursoDetallePage({ params }: { params: Promise<{ id: string }> }) {
  const { id: idTexto } = await params;
  const id = /^\d{1,9}$/.test(idTexto) ? Number(idTexto) : null;
  if (id === null) notFound();

  const puedeEditar = hasRole(await getAdminSession(), CONCURSOS_EDITAN);

  let datos;
  try {
    const concurso = await getContest(id);
    if (!concurso) notFound();
    const [posiciones, excluidos, ganadores, nombres] = await Promise.all([
      posicionesDelConcurso(concurso),
      getContestExclusions(id),
      listWinners([id]),
      nombresDeBrokers(),
    ]);
    datos = { concurso, posiciones, excluidos, ganadores: ganadores.get(id) ?? [], nombres };
  } catch (e) {
    // notFound() lanza una excepción especial de Next: no se debe tragar.
    if (e && typeof e === "object" && "digest" in e) throw e;
    return <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-red-700">No pudimos cargar el concurso.</div>;
  }

  const { concurso: c, posiciones, excluidos, ganadores, nombres } = datos;
  const hoy = fechaMexico();
  const etapa = etapaDelPeriodo(c, hoy);
  const finalizado = c.estatus === "finalizado";

  return (
    <div className="space-y-6">
      <div>
        <Link href="/backoffice/concursos" className="text-sm font-medium text-finbra-purple hover:underline">
          ← Concursos
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-bold">{c.nombre}</h1>
          <Badge variant={finalizado ? "purple" : c.estatus === "activo" ? "success" : c.estatus === "pausado" ? "warning" : "gray"}>{c.estatus}</Badge>
        </div>
        <p className="mt-1 text-sm text-finbra-gray">
          {formatFecha(c.fechaInicio)} → {formatFecha(c.fechaFin)} ·{" "}
          {etapa === "proximo" ? "Todavía no empieza" : etapa === "terminado" ? "El periodo ya terminó" : "En curso"} · Premio: {c.premio} · {c.numGanadores} ganador(es)
          {c.metaObjetivo !== null && <> · Meta para ganar: {formatValorConcurso(c.criterio, c.metaObjetivo)}</>}
        </p>
      </div>

      {puedeEditar && !finalizado && c.estatus !== "borrador" && (
        <Card>
          <FinalizarConcurso id={c.id} enCurso={etapa !== "terminado"} />
        </Card>
      )}

      {finalizado && (
        <Card highlight>
          <p className="mb-2 text-sm font-medium text-finbra-gray">
            Ganadores fijados el {c.finalizadoAt ? new Date(c.finalizadoAt).toLocaleDateString("es-MX", { timeZone: "America/Mexico_City" }) : "—"}
          </p>
          {ganadores.length === 0 ? (
            <p className="text-sm">Nadie cumplió para ganar.</p>
          ) : (
            <ol className="space-y-1 text-sm">
              {ganadores.map((g) => (
                <li key={g.premio}>
                  <span className="font-bold text-finbra-purple">#{g.premio}</span> {g.nombre} ({g.brokerId}) — {formatValorConcurso(c.criterio, g.valor)}
                  {c.criterio === "operaciones" && <span className="text-finbra-gray"> · {formatCurrency(g.monto)}</span>}
                </li>
              ))}
            </ol>
          )}
        </Card>
      )}

      <Card className="overflow-x-auto p-0">
        <p className="px-6 pt-4 text-sm font-medium text-finbra-gray">
          {finalizado ? "Tabla de hoy (los ganadores de arriba ya quedaron fijados)" : "Tabla en vivo"}
        </p>
        {posiciones.length === 0 ? (
          <p className="px-6 py-6 text-sm text-finbra-gray">Nadie ha colocado dentro del periodo todavía.</p>
        ) : (
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead>
              <tr className="border-b border-black/5 text-xs uppercase tracking-wide text-finbra-gray">
                <th className="px-6 py-3">Lugar</th>
                <th className="px-6 py-3">Broker</th>
                <th className="px-6 py-3">{c.criterio === "monto" ? "Monto colocado" : "Operaciones"}</th>
                <th className="px-6 py-3">{c.criterio === "monto" ? "Operaciones" : "Monto"}</th>
                {c.metaObjetivo !== null && <th className="px-6 py-3">Meta</th>}
                <th className="px-6 py-3">Premio</th>
              </tr>
            </thead>
            <tbody>
              {posiciones.map((p) => (
                <tr key={p.brokerId} className="border-b border-black/5 last:border-0">
                  <td className="px-6 py-3 font-semibold">#{p.lugar}</td>
                  <td className="px-6 py-3">
                    {p.nombre} <span className="text-xs text-finbra-gray">{p.brokerId}</span>
                  </td>
                  <td className="px-6 py-3 font-semibold">{formatValorConcurso(c.criterio, p.valor)}</td>
                  <td className="px-6 py-3">{c.criterio === "monto" ? p.operaciones : formatCurrency(p.monto)}</td>
                  {c.metaObjetivo !== null && (
                    <td className="px-6 py-3">
                      {p.cumpleMeta ? <Badge variant="success">Cumplida</Badge> : `${avanceHaciaMeta(p.valor, c.metaObjetivo)}%`}
                    </td>
                  )}
                  <td className="px-6 py-3">{p.premio !== null ? <Badge variant="purple">#{p.premio}</Badge> : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <Card>
        <p className="mb-3 text-sm font-medium text-finbra-gray">Brokers excluidos de este concurso</p>
        {excluidos.length === 0 ? (
          <p className="mb-3 text-sm text-finbra-gray">Ninguno. Un broker excluido no aparece en la tabla ni puede ganar.</p>
        ) : (
          <ul className="mb-3 space-y-1 text-sm">
            {excluidos.map((b) => (
              <li key={b} className="flex items-center gap-3">
                <span>
                  {nombres.get(b) ?? b} <span className="text-xs text-finbra-gray">{b}</span>
                </span>
                {puedeEditar && !finalizado && (
                  <form action={reincorporarBrokerAction.bind(null, c.id, b)}>
                    <button type="submit" className="text-xs font-semibold text-finbra-purple hover:underline">
                      Reincorporar
                    </button>
                  </form>
                )}
              </li>
            ))}
          </ul>
        )}
        {puedeEditar && !finalizado && <ExcluirBroker contestId={c.id} />}
      </Card>
    </div>
  );
}
