import { cookies } from "next/headers";
import { verifySession, SESSION_COOKIE_NAME } from "@/lib/auth";
import { listActiveContests, getContestExclusions } from "@/lib/db/contests";
import { getLeaderboard } from "@/lib/n8n";
import { formatCurrency } from "@/lib/format";
import Card from "@/components/ui/Card";
import Badge from "@/components/ui/Badge";
import EmptyState from "@/components/ui/EmptyState";
import { IconTrophy } from "@/components/ui/icons";

export default async function ConcursosPage() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  const session = token ? await verifySession(token) : null;

  let contests: Awaited<ReturnType<typeof listActiveContests>> = [];
  let leaderboard: Awaited<ReturnType<typeof getLeaderboard>> | null = null;
  let loadError = false;

  try {
    [contests, leaderboard] = await Promise.all([listActiveContests(), getLeaderboard()]);
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

  if (contests.length === 0) {
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

      {contests.map((contest) => {
        const sorted = [...(leaderboard?.ranking ?? [])].sort((a, b) =>
          contest.criterio === "operaciones" ? b.numOperaciones - a.numOperaciones : b.totalColocado - a.totalColocado,
        );

        return (
          <ContestCard key={contest.id} contest={contest} standings={sorted} miBrokerId={session?.brokerId} />
        );
      })}

      <p className="text-xs text-finbra-gray">
        El avance se calcula sobre el histórico general de colocación, todavía no acotado exactamente al periodo del
        concurso.
      </p>
    </div>
  );
}

async function ContestCard({
  contest,
  standings,
  miBrokerId,
}: {
  contest: Awaited<ReturnType<typeof listActiveContests>>[number];
  standings: Awaited<ReturnType<typeof getLeaderboard>>["ranking"];
  miBrokerId?: string;
}) {
  const exclusions = await getContestExclusions(contest.id);
  const eligibles = standings.filter((b) => !exclusions.includes(b.brokerId)).slice(0, Math.max(contest.numGanadores, 5));
  const miPosicion = eligibles.findIndex((b) => b.brokerId === miBrokerId);

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-lg font-bold text-finbra-purple">{contest.nombre}</p>
          {contest.descripcion && <p className="text-sm text-finbra-gray">{contest.descripcion}</p>}
        </div>
        <Badge variant="success">Activo</Badge>
      </div>

      <div className="mt-3 flex flex-wrap gap-4 text-xs text-finbra-gray">
        <span>
          {contest.fechaInicio} → {contest.fechaFin}
        </span>
        <span>Premio: {contest.premio}</span>
        <span>{contest.numGanadores} ganador(es)</span>
      </div>

      {miPosicion >= 0 && (
        <p className="mt-3 rounded-lg bg-finbra-purple/5 p-3 text-sm">
          Vas en el puesto <span className="font-bold text-finbra-purple">#{miPosicion + 1}</span> de este concurso.
        </p>
      )}

      <div className="mt-4 space-y-1">
        {eligibles.map((b, idx) => (
          <div
            key={b.brokerId}
            className={`flex items-center justify-between rounded-lg px-3 py-2 text-sm ${
              b.brokerId === miBrokerId ? "bg-finbra-purple/10" : ""
            }`}
          >
            <span>
              #{idx + 1} {b.nombre}
            </span>
            <span className="font-semibold">
              {contest.criterio === "operaciones" ? `${b.numOperaciones} operaciones` : formatCurrency(b.totalColocado)}
            </span>
          </div>
        ))}
      </div>
    </Card>
  );
}
