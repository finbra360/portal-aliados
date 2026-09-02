import { getStats, getLeaderboard } from "@/lib/n8n";
import { getTierProgress } from "@/lib/tiers";
import { summarizeCommissions } from "@/lib/commissions";
import { listOperations } from "@/lib/db/operations";
import { getBrokerStatusMap } from "@/lib/db/broker-status";
import { formatCurrency } from "@/lib/format";
import Card from "@/components/ui/Card";
import StatCard from "@/components/ui/StatCard";
import StatusPill from "@/components/ui/StatusPill";
import Badge from "@/components/ui/Badge";
import { updateBrokerStatusAction } from "../actions";

export default async function BrokerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: brokerId } = await params;

  let loadError = false;
  let stats: Awaited<ReturnType<typeof getStats>> | null = null;
  let leaderboard: Awaited<ReturnType<typeof getLeaderboard>> | null = null;
  let operations: Awaited<ReturnType<typeof listOperations>> = [];
  let estatus: "activo" | "suspendido" = "activo";

  try {
    [stats, leaderboard, operations] = await Promise.all([
      getStats(brokerId),
      getLeaderboard(),
      listOperations({ brokerId }),
    ]);
    const statusMap = await getBrokerStatusMap();
    estatus = statusMap[brokerId] ?? "activo";
  } catch {
    loadError = true;
  }

  if (loadError || !stats || !leaderboard) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-red-700">
        No pudimos cargar este broker en este momento.
      </div>
    );
  }

  const entry = leaderboard.ranking.find((b) => b.brokerId === brokerId);
  const position = leaderboard.ranking.findIndex((b) => b.brokerId === brokerId) + 1;
  const tier = getTierProgress(stats.totalHistorico);
  const commissions = summarizeCommissions(stats.operaciones);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold">{entry?.nombre ?? brokerId}</h1>
          <p className="text-sm text-finbra-gray">ID Broker: {brokerId}</p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={estatus === "activo" ? "success" : "warning"}>{estatus}</Badge>
          <form action={updateBrokerStatusAction.bind(null, brokerId, estatus === "activo" ? "suspendido" : "activo")}>
            <button type="submit" className="rounded-lg border border-finbra-purple/30 px-4 py-2 text-sm font-semibold text-finbra-purple">
              {estatus === "activo" ? "Suspender" : "Reactivar"}
            </button>
          </form>
        </div>
      </div>

      {estatus === "suspendido" && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          Este broker está marcado como suspendido. Nota: esto todavía no bloquea su login en el portal — falta
          conectar esta bandera al workflow de n8n del login (documentado como pendiente).
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Total histórico colocado" value={formatCurrency(stats.totalHistorico)} />
        <StatCard label="Créditos colocados" value={String(stats.creditosCount)} />
        <StatCard label="Posición en ranking" value={position ? `#${position}` : "—"} sublabel={`de ${leaderboard.ranking.length}`} />
        <StatCard label="Comisión generada" value={formatCurrency(commissions.totalGenerado)} />
      </div>

      <Card>
        <p className="mb-2 text-sm text-finbra-gray">Nivel actual</p>
        <p className="text-xl font-bold" style={{ color: tier.actual.color }}>
          {tier.actual.nombre}
        </p>
      </Card>

      <Card className="overflow-x-auto p-0">
        <p className="px-6 pt-4 text-sm font-medium text-finbra-gray">Operaciones en pipeline (backoffice)</p>
        {operations.length === 0 ? (
          <p className="px-6 py-6 text-sm text-finbra-gray">Sin operaciones registradas en el pipeline todavía.</p>
        ) : (
          <table className="mt-2 w-full min-w-[480px] text-left text-sm">
            <thead>
              <tr className="border-b border-black/5 text-xs uppercase tracking-wide text-finbra-gray">
                <th className="px-6 py-3">Cliente</th>
                <th className="px-6 py-3">Monto</th>
                <th className="px-6 py-3">Etapa</th>
              </tr>
            </thead>
            <tbody>
              {operations.map((op) => (
                <tr key={op.id} className="border-b border-black/5 last:border-0">
                  <td className="px-6 py-4">{op.clienteReferencia}</td>
                  <td className="px-6 py-4">{formatCurrency(op.montoSolicitado)}</td>
                  <td className="px-6 py-4">
                    <StatusPill status={op.etapa} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
