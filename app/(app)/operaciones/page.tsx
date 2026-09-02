import { cookies } from "next/headers";
import { verifySession, SESSION_COOKIE_NAME } from "@/lib/auth";
import { getStats } from "@/lib/n8n";
import { listOperations } from "@/lib/db/operations";
import { formatCurrency } from "@/lib/format";
import Card from "@/components/ui/Card";
import EmptyState from "@/components/ui/EmptyState";
import StatusPill from "@/components/ui/StatusPill";
import { IconListChecks } from "@/components/ui/icons";

export default async function OperacionesPage() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  const session = token ? await verifySession(token) : null;

  if (!session) {
    return null;
  }

  let stats: Awaited<ReturnType<typeof getStats>> | null = null;
  let pipeline: Awaited<ReturnType<typeof listOperations>> = [];
  let loadError = false;
  try {
    [stats, pipeline] = await Promise.all([getStats(session.brokerId), listOperations({ brokerId: session.brokerId })]);
  } catch {
    loadError = true;
  }

  if (loadError || !stats) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-red-700">
        No pudimos cargar tus operaciones en este momento. Intenta de nuevo más tarde.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Mis Operaciones</h1>

      <div>
        <p className="mb-3 text-sm font-medium text-finbra-gray">En proceso</p>
        {pipeline.length === 0 ? (
          <EmptyState
            icon={<IconListChecks />}
            title="No tienes solicitudes en proceso"
            description="En cuanto Finbra registre una solicitud tuya, vas a poder seguir su etapa aquí."
          />
        ) : (
          <Card className="overflow-x-auto p-0">
            <table className="w-full min-w-[480px] text-left text-sm">
              <thead>
                <tr className="border-b border-black/5 text-xs uppercase tracking-wide text-finbra-gray">
                  <th className="px-6 py-3">Cliente</th>
                  <th className="px-6 py-3">Monto solicitado</th>
                  <th className="px-6 py-3">Etapa</th>
                </tr>
              </thead>
              <tbody>
                {pipeline.map((op) => (
                  <tr key={op.id} className="border-b border-black/5 last:border-0">
                    <td className="px-6 py-4">{op.clienteReferencia}</td>
                    <td className="px-6 py-4 font-semibold">{formatCurrency(op.montoSolicitado)}</td>
                    <td className="px-6 py-4">
                      <StatusPill status={op.etapa} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        )}
      </div>

      <div>
        <p className="mb-3 text-sm font-medium text-finbra-gray">Fondeadas</p>
        {stats.operaciones.length === 0 ? (
          <EmptyState
            icon={<IconListChecks />}
            title="Todavía no tienes operaciones fondeadas"
            description="En cuanto se registre tu primera colocación con Finbra, aparecerá aquí."
          />
        ) : (
          <Card className="overflow-x-auto p-0">
            <table className="w-full min-w-[420px] text-left text-sm">
              <thead>
                <tr className="border-b border-black/5 text-xs uppercase tracking-wide text-finbra-gray">
                  <th className="px-6 py-3">Fecha</th>
                  <th className="px-6 py-3">Monto</th>
                  <th className="px-6 py-3">Estatus</th>
                </tr>
              </thead>
              <tbody>
                {stats.operaciones.map((op, idx) => (
                  <tr key={`${op.fecha}-${idx}`} className="border-b border-black/5 last:border-0">
                    <td className="px-6 py-4">{op.fecha}</td>
                    <td className="px-6 py-4 font-semibold">{formatCurrency(op.monto)}</td>
                    <td className="px-6 py-4">
                      <StatusPill status="fondeada" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        )}
      </div>
    </div>
  );
}
