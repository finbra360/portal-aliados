import { getLeaderboard, getStats } from "@/lib/n8n";
import { summarizeCommissions } from "@/lib/commissions";
import { listCommissionPayments } from "@/lib/db/commission-payments";
import { formatCurrency } from "@/lib/format";
import Card from "@/components/ui/Card";
import Badge from "@/components/ui/Badge";
import { setCommissionStatusAction } from "./actions";
import CommissionStatusSelect from "./CommissionStatusSelect";

export default async function BackofficeComisionesPage() {
  let loadError = false;
  let rows: {
    brokerId: string;
    brokerNombre: string;
    fecha: string;
    monto: number;
    brokerPct: number | null;
    montoTotal: number;
    estatus: "generada" | "aprobada" | "pagada" | "sin_definir";
  }[] = [];

  try {
    const leaderboard = await getLeaderboard();
    const [allStats, payments] = await Promise.all([
      Promise.all(leaderboard.ranking.map((b) => getStats(b.brokerId).then((s) => ({ broker: b, stats: s })))),
      listCommissionPayments(),
    ]);

    rows = allStats.flatMap(({ broker, stats }) =>
      summarizeCommissions(stats.operaciones).lines.map((line) => {
        const payment = payments.find((p) => p.brokerId === broker.brokerId && p.operacionFecha === line.operacion.fecha);
        return {
          brokerId: broker.brokerId,
          brokerNombre: broker.nombre,
          fecha: line.operacion.fecha,
          monto: line.operacion.monto,
          brokerPct: line.brokerPct,
          montoTotal: line.montoTotal,
          estatus: line.brokerPct === null ? ("sin_definir" as const) : payment?.estatus ?? "generada",
        };
      }),
    );
  } catch {
    loadError = true;
  }

  if (loadError) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-red-700">
        No pudimos cargar las comisiones en este momento.
      </div>
    );
  }

  const totalGenerado = rows.reduce((sum, r) => sum + r.montoTotal, 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Comisiones</h1>
        <p className="text-sm text-finbra-gray">
          Total generado: <span className="font-bold text-finbra-purple">{formatCurrency(totalGenerado)}</span>
        </p>
      </div>

      <Card className="overflow-x-auto p-0">
        <table className="w-full min-w-[640px] text-left text-sm">
          <thead>
            <tr className="border-b border-black/5 text-xs uppercase tracking-wide text-finbra-gray">
              <th className="px-6 py-3">Broker</th>
              <th className="px-6 py-3">Fecha</th>
              <th className="px-6 py-3">Monto</th>
              <th className="px-6 py-3">Comisión</th>
              <th className="px-6 py-3">Estatus</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={`${r.brokerId}-${r.fecha}`} className="border-b border-black/5 last:border-0">
                <td className="px-6 py-4">{r.brokerNombre}</td>
                <td className="px-6 py-4">{r.fecha}</td>
                <td className="px-6 py-4">{formatCurrency(r.monto)}</td>
                <td className="px-6 py-4 font-semibold">{formatCurrency(r.montoTotal)}</td>
                <td className="px-6 py-4">
                  {r.estatus === "sin_definir" ? (
                    <Badge variant="warning">% apertura sin definir</Badge>
                  ) : (
                    <CommissionStatusSelect
                      current={r.estatus}
                      onChange={setCommissionStatusAction.bind(null, r.brokerId, r.fecha, r.monto, r.montoTotal)}
                    />
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
