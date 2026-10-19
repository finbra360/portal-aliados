import type { Metadata } from "next";
import { cookies } from "next/headers";
import { getStats } from "@/lib/db/colocacion";
import { verifySession, SESSION_COOKIE_NAME } from "@/lib/auth";
import { buscarPago, estatusDeLinea, summarizeCommissions, totalesPorEstatus, type EstatusPago } from "@/lib/commissions";
import { listCommissionPayments } from "@/lib/db/commission-payments";
import { formatCurrency } from "@/lib/format";
import Card from "@/components/ui/Card";
import StatCard from "@/components/ui/StatCard";
import EmptyState from "@/components/ui/EmptyState";
import Badge from "@/components/ui/Badge";
import { IconCoins } from "@/components/ui/icons";

const ETIQUETA_ESTATUS: Record<EstatusPago, { texto: string; variante: "success" | "warning" | "gray" | "purple" }> = {
  generada: { texto: "Generada", variante: "gray" },
  aprobada: { texto: "Aprobada · por pagar", variante: "purple" },
  pagada: { texto: "Pagada", variante: "success" },
  sin_definir: { texto: "Falta % de apertura", variante: "warning" },
};

export const metadata: Metadata = { title: "Comisiones" };

export default async function ComisionesPage() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  const session = token ? await verifySession(token) : null;

  if (!session) {
    return null;
  }

  let stats: Awaited<ReturnType<typeof getStats>> | null = null;
  let pagos: Awaited<ReturnType<typeof listCommissionPayments>> = [];
  let loadError = false;
  try {
    [stats, pagos] = await Promise.all([getStats(session.brokerId), listCommissionPayments(session.brokerId)]);
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
  const lineas = summary.lines.map((line) => {
    const pago = buscarPago(pagos, line.operacion);
    return { line, pago, estatus: estatusDeLinea(line, pago) };
  });
  const totales = totalesPorEstatus(lineas);

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
          <div className="grid gap-4 sm:grid-cols-3">
            <StatCard label="Comisión total generada" value={formatCurrency(summary.totalGenerado)} icon={<IconCoins />} />
            <StatCard label="Por pagar" value={formatCurrency(totales.porPagar)} sublabel="Generada o aprobada, aún sin pago" />
            <StatCard
              label="Ya pagado"
              value={formatCurrency(totales.pagado)}
              sublabel={summary.countPendienteDefinir > 0 ? `${summary.countPendienteDefinir} sin % de apertura capturado` : undefined}
            />
          </div>

          <Card className="overflow-x-auto p-0">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead>
                <tr className="border-b border-black/5 text-xs uppercase tracking-wide text-finbra-gray">
                  <th scope="col" className="px-6 py-3">Fecha</th>
                  <th scope="col" className="px-6 py-3">Monto colocado</th>
                  <th scope="col" className="px-6 py-3">% apertura</th>
                  <th scope="col" className="px-6 py-3">Comisión</th>
                  <th scope="col" className="px-6 py-3">Bono pagado</th>
                  <th scope="col" className="px-6 py-3">Total</th>
                  <th scope="col" className="px-6 py-3">Estatus</th>
                </tr>
              </thead>
              <tbody>
                {lineas.map(({ line, pago, estatus }, idx) => (
                  <tr key={line.operacion.id ?? `${line.operacion.fecha}-${idx}`} className="border-b border-black/5 last:border-0">
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
                    <td className="px-6 py-4">
                      <Badge variant={ETIQUETA_ESTATUS[estatus].variante}>{ETIQUETA_ESTATUS[estatus].texto}</Badge>
                      {estatus === "pagada" && pago?.fechaPago && (
                        <span className="mt-1 block text-xs text-finbra-gray">{pago.fechaPago.slice(0, 10)}</span>
                      )}
                    </td>
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
    </div>
  );
}
