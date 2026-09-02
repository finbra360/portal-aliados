import { getLeaderboard, getStats } from "@/lib/n8n";
import { summarizeCommissions } from "@/lib/commissions";
import { countOperationsByStage } from "@/lib/db/operations";
import { formatCurrency } from "@/lib/format";
import Card from "@/components/ui/Card";
import StatCard from "@/components/ui/StatCard";
import { IconWallet, IconListChecks, IconTrophy, IconCoins } from "@/components/ui/icons";

export default async function BackofficeDashboardPage() {
  let loadError = false;
  let leaderboard: Awaited<ReturnType<typeof getLeaderboard>> | null = null;
  let totalComisiones = 0;
  let stageCounts: Awaited<ReturnType<typeof countOperationsByStage>> | null = null;

  try {
    leaderboard = await getLeaderboard();
    const allStats = await Promise.all(leaderboard.ranking.map((b) => getStats(b.brokerId)));
    totalComisiones = allStats.reduce((sum, s) => sum + summarizeCommissions(s.operaciones).totalGenerado, 0);
    stageCounts = await countOperationsByStage();
  } catch {
    loadError = true;
  }

  if (loadError || !leaderboard || !stageCounts) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-red-700">
        No pudimos cargar el dashboard ejecutivo en este momento.
      </div>
    );
  }

  const totalColocado = leaderboard.ranking.reduce((sum, b) => sum + b.totalColocado, 0);
  const totalOperacionesFondeadas = leaderboard.ranking.reduce((sum, b) => sum + b.numOperaciones, 0);
  const enProceso =
    stageCounts.recibida +
    stageCounts.documentacion_pendiente +
    stageCounts.en_analisis +
    stageCounts.aprobada +
    stageCounts.formalizacion;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Dashboard ejecutivo</h1>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Colocación total (histórica)" value={formatCurrency(totalColocado)} icon={<IconWallet />} />
        <StatCard label="Operaciones fondeadas" value={String(totalOperacionesFondeadas)} icon={<IconListChecks />} />
        <StatCard label="Brokers activos" value={String(leaderboard.ranking.length)} icon={<IconTrophy />} />
        <StatCard label="Comisión total generada" value={formatCurrency(totalComisiones)} icon={<IconCoins />} />
      </div>

      <Card>
        <p className="mb-3 text-sm font-medium text-finbra-gray">Operaciones por etapa (pipeline)</p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
          {Object.entries(stageCounts).map(([etapa, count]) => (
            <div key={etapa} className="rounded-lg bg-finbra-purple/5 p-3 text-center">
              <p className="text-2xl font-bold text-finbra-purple">{count}</p>
              <p className="mt-1 text-[11px] capitalize text-finbra-gray">{etapa.replace(/_/g, " ")}</p>
            </div>
          ))}
        </div>
        <p className="mt-3 text-xs text-finbra-gray">{enProceso} operaciones en proceso, {stageCounts.fondeada} fondeadas, {stageCounts.rechazada} rechazadas — desde el pipeline capturado en el backoffice (no incluye el histórico anterior a esta fecha).</p>
      </Card>

      <Card className="overflow-x-auto p-0">
        <table className="w-full min-w-[480px] text-left text-sm">
          <thead>
            <tr className="border-b border-black/5 text-xs uppercase tracking-wide text-finbra-gray">
              <th className="px-6 py-3">Broker</th>
              <th className="px-6 py-3">Colocado</th>
              <th className="px-6 py-3">Operaciones</th>
            </tr>
          </thead>
          <tbody>
            {leaderboard.ranking.map((b) => (
              <tr key={b.brokerId} className="border-b border-black/5 last:border-0">
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
