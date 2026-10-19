import type { Metadata } from "next";
import { cookies } from "next/headers";
import { verifySession, SESSION_COOKIE_NAME } from "@/lib/auth";
import { listActiveContests, listFinishedContests, listWinners, posicionesDelConcurso, type Contest, type Ganador } from "@/lib/db/contests";
import { avanceHaciaMeta, diasRestantes, etapaDelPeriodo, type PosicionConcurso } from "@/lib/concursos";
import { fechaMexico } from "@/lib/collections/rules";
import { formatFecha, formatValorConcurso } from "@/lib/format";
import Card from "@/components/ui/Card";
import Badge from "@/components/ui/Badge";
import EmptyState from "@/components/ui/EmptyState";
import { IconTrophy } from "@/components/ui/icons";

interface ConcursoActivo {
  contest: Contest;
  posiciones: PosicionConcurso[];
}

export const metadata: Metadata = { title: "Concursos" };

export default async function ConcursosPage() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  const session = token ? await verifySession(token) : null;
  const hoy = fechaMexico();

  let activos: ConcursoActivo[] = [];
  let finalizados: Contest[] = [];
  let ganadores = new Map<number, Ganador[]>();
  let loadError = false;

  try {
    const [vigentes, cerrados] = await Promise.all([listActiveContests(), listFinishedContests()]);
    finalizados = cerrados;
    [activos, ganadores] = await Promise.all([
      Promise.all(
        vigentes.map(async (contest) => ({
          contest,
          // Un concurso que todavía no empieza no tiene tabla que mostrar.
          posiciones: etapaDelPeriodo(contest, hoy) === "proximo" ? [] : await posicionesDelConcurso(contest),
        })),
      ),
      listWinners(cerrados.map((c) => c.id)),
    ]);
  } catch {
    loadError = true;
  }

  if (loadError) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-red-700">
        No pudimos cargar los concursos en este momento.
      </div>
    );
  }

  if (activos.length === 0 && finalizados.length === 0) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold">Concursos</h1>
        <EmptyState
          icon={<IconTrophy />}
          title="No hay concursos activos por el momento"
          description="Cuando Finbra lance un concurso (mensual, trimestral o especial), vas a poder ver aquí las reglas, el periodo, el premio y tu posición en tiempo real."
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Concursos</h1>

      {activos.map(({ contest, posiciones }) => (
        <ContestCard key={contest.id} contest={contest} posiciones={posiciones} miBrokerId={session?.brokerId} hoy={hoy} />
      ))}

      {finalizados.length > 0 && (
        <div className="space-y-4">
          <p className="text-sm font-medium text-finbra-gray">Concursos anteriores</p>
          {finalizados.map((contest) => (
            <FinishedCard key={contest.id} contest={contest} ganadores={ganadores.get(contest.id) ?? []} miBrokerId={session?.brokerId} />
          ))}
        </div>
      )}

      <p className="text-xs text-finbra-gray">
        En cada concurso cuenta solo la colocación con fecha dentro de su periodo. Si el concurso tiene meta, solo pueden
        ganar quienes la alcanzan; en caso de empate gana quien llegó primero.
      </p>
    </div>
  );
}

function ContestCard({
  contest,
  posiciones,
  miBrokerId,
  hoy,
}: {
  contest: Contest;
  posiciones: PosicionConcurso[];
  miBrokerId?: string;
  hoy: string;
}) {
  const etapa = etapaDelPeriodo(contest, hoy);
  const mia = posiciones.find((p) => p.brokerId === miBrokerId);
  const visibles = posiciones.slice(0, Math.max(contest.numGanadores, 5));
  const estoyFuera = mia && !visibles.some((p) => p.brokerId === mia.brokerId);
  const avance = mia ? avanceHaciaMeta(mia.valor, contest.metaObjetivo) : null;
  const dias = diasRestantes(contest.fechaFin, hoy);

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-lg font-bold text-finbra-purple">{contest.nombre}</p>
          {contest.descripcion && <p className="text-sm text-finbra-gray">{contest.descripcion}</p>}
        </div>
        {etapa === "proximo" ? (
          <Badge variant="warning">Próximamente</Badge>
        ) : etapa === "terminado" ? (
          <Badge variant="gray">Periodo terminado</Badge>
        ) : (
          <Badge variant="success">{dias === 1 ? "Último día" : `${dias} días restantes`}</Badge>
        )}
      </div>

      <div className="mt-3 flex flex-wrap gap-4 text-xs text-finbra-gray">
        <span>
          {formatFecha(contest.fechaInicio)} → {formatFecha(contest.fechaFin)}
        </span>
        <span>Premio: {contest.premio}</span>
        <span>{contest.numGanadores} ganador(es)</span>
        <span>Gana quien tenga más {contest.criterio === "monto" ? "monto colocado" : "operaciones"}</span>
        {contest.metaObjetivo !== null && <span>Meta para ganar: {formatValorConcurso(contest.criterio, contest.metaObjetivo)}</span>}
      </div>

      {etapa === "proximo" && <p className="mt-4 rounded-lg bg-finbra-purple/5 p-3 text-sm">El concurso empieza el {formatFecha(contest.fechaInicio)}.</p>}
      {etapa === "terminado" && (
        <p className="mt-4 rounded-lg bg-finbra-purple/5 p-3 text-sm">
          El periodo ya terminó. Finbra confirmará a los ganadores en cuanto cierre el concurso; esta tabla puede cambiar hasta entonces.
        </p>
      )}

      {etapa !== "proximo" && (
        <>
          {mia ? (
            <div className="mt-4 space-y-2 rounded-lg bg-finbra-purple/5 p-3 text-sm">
              <p>
                Vas en el lugar <span className="font-bold text-finbra-purple">#{mia.lugar}</span> con{" "}
                <span className="font-semibold">{formatValorConcurso(contest.criterio, mia.valor)}</span>
                {mia.premio !== null && <> — hoy estarías entre los ganadores.</>}
              </p>
              {contest.metaObjetivo !== null && avance !== null && (
                <div>
                  <div className="h-2 overflow-hidden rounded-full bg-black/10" role="progressbar" aria-valuenow={avance} aria-valuemin={0} aria-valuemax={100} aria-label="Avance hacia la meta">
                    <div className="h-full rounded-full bg-finbra-purple" style={{ width: `${avance}%` }} />
                  </div>
                  <p className="mt-1 text-xs text-finbra-gray">
                    {mia.cumpleMeta
                      ? "Ya alcanzaste la meta."
                      : `Te faltan ${formatValorConcurso(contest.criterio, contest.metaObjetivo - mia.valor)} para la meta (${avance}%).`}
                  </p>
                </div>
              )}
            </div>
          ) : (
            <p className="mt-4 rounded-lg bg-finbra-purple/5 p-3 text-sm">
              Todavía no tienes colocación dentro del periodo de este concurso.
            </p>
          )}

          {visibles.length === 0 ? (
            <p className="mt-4 text-sm text-finbra-gray">{etapa === "terminado" ? "Nadie colocó dentro del periodo." : "Nadie ha colocado dentro del periodo todavía."}</p>
          ) : (
            <div className="mt-4 space-y-1">
              {visibles.map((p) => (
                <Fila key={p.brokerId} p={p} criterio={contest.criterio} esMia={p.brokerId === miBrokerId} />
              ))}
              {estoyFuera && mia && (
                <>
                  <p className="px-3 text-xs text-finbra-gray">…</p>
                  <Fila p={mia} criterio={contest.criterio} esMia />
                </>
              )}
            </div>
          )}
        </>
      )}
    </Card>
  );
}

function Fila({ p, criterio, esMia }: { p: PosicionConcurso; criterio: "monto" | "operaciones"; esMia: boolean }) {
  return (
    <div className={`flex items-center justify-between rounded-lg px-3 py-2 text-sm ${esMia ? "bg-finbra-purple/10" : ""}`}>
      <span>
        #{p.lugar} {p.nombre}
        {p.premio !== null && <span className="ml-2 align-middle"><Badge variant="purple">Premio</Badge></span>}
      </span>
      <span className="font-semibold">{formatValorConcurso(criterio, p.valor)}</span>
    </div>
  );
}

function FinishedCard({ contest, ganadores, miBrokerId }: { contest: Contest; ganadores: Ganador[]; miBrokerId?: string }) {
  const gane = ganadores.some((g) => g.brokerId === miBrokerId);
  return (
    <Card highlight={gane}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="font-bold text-finbra-purple">{contest.nombre}</p>
          <p className="text-xs text-finbra-gray">
            {formatFecha(contest.fechaInicio)} → {formatFecha(contest.fechaFin)} · Premio: {contest.premio}
          </p>
        </div>
        <Badge variant="purple">Finalizado</Badge>
      </div>
      {gane && <p className="mt-3 rounded-lg bg-finbra-purple/10 p-3 text-sm font-semibold text-finbra-purple-700">¡Felicidades, ganaste este concurso!</p>}
      {ganadores.length === 0 ? (
        <p className="mt-3 text-sm text-finbra-gray">Nadie cumplió las condiciones para ganar.</p>
      ) : (
        <div className="mt-3 space-y-1">
          {ganadores.map((g) => (
            <div key={g.premio} className={`flex items-center justify-between rounded-lg px-3 py-2 text-sm ${g.brokerId === miBrokerId ? "bg-finbra-purple/10" : ""}`}>
              <span>
                #{g.premio} {g.nombre}
              </span>
              <span className="font-semibold">{formatValorConcurso(contest.criterio, g.valor)}</span>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
