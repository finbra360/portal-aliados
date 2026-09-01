import { cookies } from "next/headers";
import { verifySession, SESSION_COOKIE_NAME } from "@/lib/auth";
import { getLeaderboard } from "@/lib/n8n";
import { formatCurrency } from "@/lib/format";
import Card from "@/components/ui/Card";
import { IconTrophy } from "@/components/ui/icons";

export default async function RankingPage() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  const session = token ? await verifySession(token) : null;

  let leaderboard: Awaited<ReturnType<typeof getLeaderboard>> | null = null;
  let loadError = false;
  try {
    leaderboard = await getLeaderboard();
  } catch {
    loadError = true;
  }

  if (loadError || !leaderboard) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-red-700">
        No pudimos cargar el ranking en este momento. Intenta de nuevo más tarde.
      </div>
    );
  }

  if (!leaderboard.ranking.length) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold">Ranking de brokers</h1>
        <Card className="flex flex-col items-center gap-2 py-10 text-center">
          <IconTrophy className="text-finbra-purple/40" />
          <p className="font-medium">Todavía no hay colocaciones registradas.</p>
          <p className="max-w-sm text-sm text-finbra-gray">
            En cuanto se registre la primera colocación, el ranking empezará a llenarse aquí.
          </p>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Ranking de brokers</h1>
        <p className="text-sm text-finbra-gray">Ordenado por monto total colocado con Finbra.</p>
      </div>

      <Card className="overflow-x-auto p-0">
        <table className="w-full min-w-[480px] text-left text-sm">
          <thead>
            <tr className="border-b border-black/5 text-xs uppercase tracking-wide text-finbra-gray">
              <th className="px-6 py-3">Posición</th>
              <th className="px-6 py-3">Broker</th>
              <th className="px-6 py-3">Colocado</th>
              <th className="px-6 py-3">Operaciones</th>
              <th className="px-6 py-3">Ticket promedio</th>
            </tr>
          </thead>
          <tbody>
            {leaderboard.ranking.map((entry, idx) => {
              const isMe = entry.brokerId === session?.brokerId;
              return (
                <tr
                  key={entry.brokerId}
                  className={`border-b border-black/5 last:border-0 ${isMe ? "bg-finbra-purple/5" : ""}`}
                >
                  <td className="px-6 py-4 font-bold text-finbra-purple">#{idx + 1}</td>
                  <td className="px-6 py-4">
                    {entry.nombre}
                    {isMe && (
                      <span className="ml-2 rounded-full bg-finbra-purple/10 px-2 py-0.5 text-xs font-semibold text-finbra-purple">
                        Tú
                      </span>
                    )}
                  </td>
                  <td className="px-6 py-4 font-semibold">{formatCurrency(entry.totalColocado)}</td>
                  <td className="px-6 py-4">{entry.numOperaciones}</td>
                  <td className="px-6 py-4">{formatCurrency(entry.ticketPromedio)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>

      <p className="text-xs text-finbra-gray">
        El ranking hoy se calcula por monto colocado. Más adelante podrá incluir otros criterios (número de
        operaciones, puntos, calidad de expediente) cuando Finbra defina esas reglas.
      </p>
    </div>
  );
}
