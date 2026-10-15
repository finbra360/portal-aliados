import { getTierProgress } from "@/lib/tiers";
import { getLeaderboard, listColocaciones } from "@/lib/db/colocacion";
import { calcularStats } from "@/lib/brokers/colocacion";
import { calcCommissionLine, summarizeCommissions } from "@/lib/commissions";
import { listOperations } from "@/lib/db/operations";
import { getBrokerStatusMap } from "@/lib/db/broker-status";
import { getBroker } from "@/lib/db/brokers";
import { getAdminSession } from "@/lib/get-admin-session";
import { hasRole } from "@/lib/rbac";
import { codigoDeError } from "@/lib/collections/errors";
import { fechaMexico } from "@/lib/collections/rules";
import { formatCurrency } from "@/lib/format";
import Card from "@/components/ui/Card";
import StatCard from "@/components/ui/StatCard";
import StatusPill from "@/components/ui/StatusPill";
import Badge from "@/components/ui/Badge";
import { updateBrokerStatusAction } from "../actions";
import { DatosBroker } from "../BrokerForms";
import { BROKERS_EDITAN, COLOCACION_EDITAN } from "../roles";
import ColocacionPanel, { type LineaColocacion } from "./ColocacionPanel";

export default async function BrokerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: brokerId } = await params;
  const session = await getAdminSession();
  const puedeEditar = hasRole(session, BROKERS_EDITAN);
  const puedeCapturar = hasRole(session, COLOCACION_EDITAN);

  let datos;
  try {
    const [broker, colocaciones, leaderboard, operations, statusMap] = await Promise.all([
      getBroker(brokerId),
      listColocaciones(brokerId),
      getLeaderboard(),
      listOperations({ brokerId }),
      getBrokerStatusMap(),
    ]);
    datos = { broker, colocaciones, leaderboard, operations, estatus: statusMap[brokerId] ?? "activo" };
  } catch (e) {
    const c = codigoDeError("brokers: perfil", e);
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-red-700">
        No pudimos cargar este broker en este momento. (código {c})
      </div>
    );
  }

  const { broker, colocaciones, leaderboard, operations, estatus } = datos;
  if (!broker) {
    return <div className="rounded-xl border border-black/5 bg-white p-6 text-finbra-gray">No encontramos el broker {brokerId}.</div>;
  }

  const stats = calcularStats(colocaciones);
  const position = leaderboard.ranking.findIndex((b) => b.brokerId === brokerId) + 1;
  const tier = getTierProgress(stats.totalHistorico);
  const commissions = summarizeCommissions(stats.operaciones);
  const lineas: LineaColocacion[] = colocaciones.map((c) => {
    const l = calcCommissionLine({ fecha: c.fecha, monto: c.monto, comisionAperturaPct: c.comisionAperturaPct ?? undefined, pagadoTotalidad: c.pagadoTotalidad });
    return { ...c, comisionBroker: l.brokerPct === null ? null : l.montoTotal };
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold">{broker.nombre}</h1>
          <p className="text-sm text-finbra-gray">ID Broker: {brokerId}</p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={estatus === "activo" ? "success" : "warning"}>{estatus}</Badge>
          {puedeEditar && (
            <form action={updateBrokerStatusAction.bind(null, brokerId, estatus === "activo" ? "suspendido" : "activo")}>
              <button type="submit" className="rounded-lg border border-finbra-purple/30 px-4 py-2 text-sm font-semibold text-finbra-purple">
                {estatus === "activo" ? "Suspender" : "Reactivar"}
              </button>
            </form>
          )}
        </div>
      </div>

      <Card>
        <DatosBroker broker={broker} puedeEditar={puedeEditar} />
      </Card>

      {estatus === "suspendido" && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          Este broker está suspendido: ya no puede pedir código para entrar al portal. Si tenía una sesión abierta, le
          dura hasta que venza (máximo 7 días).
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

      <Card className="p-0">
        <p className="px-6 pt-4 pb-2 text-sm font-medium text-finbra-gray">Colocación (créditos fondeados)</p>
        <ColocacionPanel brokerId={brokerId} lineas={lineas} puedeEditar={puedeCapturar} hoy={fechaMexico()} />
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
