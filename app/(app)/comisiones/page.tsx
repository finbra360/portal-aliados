import { cookies } from "next/headers";
import { verifySession, SESSION_COOKIE_NAME } from "@/lib/auth";
import { getStats } from "@/lib/n8n";
import { summarizeCommissions } from "@/lib/commissions";
import { formatCurrency } from "@/lib/format";
import Card from "@/components/ui/Card";
import StatCard from "@/components/ui/StatCard";
import EmptyState from "@/components/ui/EmptyState";
import Badge from "@/components/ui/Badge";
import { IconCoins } from "@/components/ui/icons";

export default async function ComisionesPage() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  const session = token ? await verifySession(token) : null;

  if (!session) {
    return null;
  }

  let stats: Awaited<ReturnType<typeof getStats>> | null = null;
  let loadError = false;
  try {
    stats = await getStats(session.brokerId);
  } catch {
    loadError = true;
  }

  if (loadError || !stats) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-red-700">
        No pudimos cargar tus comisiones en este momento. Intenta de nuevo más tarde.
      </div>
    );
  }

  const summary = summarizeCommissions(stats.operaciones);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Comisiones</h1>

      {stats.operaciones.length === 0 ? (
        <EmptyState
          icon={<IconCoins />}
          title="Todavía no tienes comisiones generadas"
          description="En cuanto tengas tu primera colocación con Finbra, tu comisión aparecerá aquí."
        />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <StatCard label="Comisión total generada" value={formatCurrency(summary.totalGenerado)} icon={<IconCoins />} />
            <StatCard
              label="Operaciones colocadas"
              value={String(stats.operaciones.length)}
              sublabel={summary.countPendienteDefinir > 0 ? `${summary.countPendienteDefinir} sin % de apertura capturado` : undefined}
            />
          </div>

          <Card className="overflow-x-auto p-0">
            <table className="w-full min-w-[560px] text-left text-sm">
              <thead>
                <tr className="border-b border-black/5 text-xs uppercase tracking-wide text-finbra-gray">
                  <th className="px-6 py-3">Fecha</th>
                  <th className="px-6 py-3">Monto colocado</th>
                  <th className="px-6 py-3">% apertura</th>
                  <th className="px-6 py-3">Comisión</th>
                  <th className="px-6 py-3">Bono pagado</th>
                  <th className="px-6 py-3">Total</th>
                </tr>
              </thead>
              <tbody>
                {summary.lines.map((line, idx) => (
                  <tr key={`${line.operacion.fecha}-${idx}`} className="border-b border-black/5 last:border-0">
                    <td className="px-6 py-4">{line.operacion.fecha}</td>
                    <td className="px-6 py-4">{formatCurrency(line.operacion.monto)}</td>
                    <td className="px-6 py-4">
                      {line.brokerPct !== null ? (
                        `${line.operacion.comisionAperturaPct}%`
                      ) : (
                        <Badge variant="warning">Sin definir</Badge>
                      )}
                    </td>
                    <td className="px-6 py-4">{formatCurrency(line.montoBase)}</td>
                    <td className="px-6 py-4">
                      {line.operacion.pagadoTotalidad ? (
                        <Badge variant="success">+{formatCurrency(line.montoBono)}</Badge>
                      ) : (
                        <span className="text-finbra-gray">—</span>
                      )}
                    </td>
                    <td className="px-6 py-4 font-semibold">{formatCurrency(line.montoTotal)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>

          {summary.countPendienteDefinir > 0 && (
            <p className="text-xs text-finbra-gray">
              {summary.countPendienteDefinir} operación(es) todavía no tienen capturado el % de comisión de apertura,
              así que no se incluyen en el total. En cuanto se capture, tu comisión total se actualiza sola.
            </p>
          )}
        </>
      )}

      <EmptyState
        title="Estatus de pago — próximamente"
        description="Aquí vas a poder ver si tu comisión ya generada está pendiente de pago o ya fue pagada, en cuanto conectemos esa información."
      />
    </div>
  );
}
