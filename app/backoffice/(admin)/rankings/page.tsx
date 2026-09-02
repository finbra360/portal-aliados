import { getLeaderboard } from "@/lib/n8n";
import { formatCurrency } from "@/lib/format";
import Card from "@/components/ui/Card";

export default async function BackofficeRankingsPage() {
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
        No pudimos cargar el ranking en este momento.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Rankings</h1>
        <p className="text-sm text-finbra-gray">
          Este es el ranking general (por monto colocado) que ven los brokers hoy. Elegir un periodo/criterio
          "oficial" distinto por concurso vive en el módulo de Concursos — un ranking configurable independiente
          queda para Fase 2.
        </p>
      </div>

      <Card className="overflow-x-auto p-0">
        <table className="w-full min-w-[520px] text-left text-sm">
          <thead>
            <tr className="border-b border-black/5 text-xs uppercase tracking-wide text-finbra-gray">
              <th className="px-6 py-3">Posición</th>
              <th className="px-6 py-3">Broker</th>
              <th className="px-6 py-3">Colocado</th>
              <th className="px-6 py-3">Operaciones</th>
            </tr>
          </thead>
          <tbody>
            {leaderboard.ranking.map((b, idx) => (
              <tr key={b.brokerId} className="border-b border-black/5 last:border-0">
                <td className="px-6 py-4 font-bold text-finbra-purple">#{idx + 1}</td>
                <td className="px-6 py-4">{b.nombre}</td>
                <td className="px-6 py-4 font-semibold">{formatCurrency(b.totalColocado)}</td>
                <td className="px-6 py-4">{b.numOperaciones}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
