import Link from "next/link";
import { getLeaderboard } from "@/lib/db/colocacion";
import { listBrokers, type Broker } from "@/lib/db/brokers";
import { getBrokerStatusMap } from "@/lib/db/broker-status";
import { getAdminSession } from "@/lib/get-admin-session";
import { hasRole } from "@/lib/rbac";
import { codigoDeError } from "@/lib/collections/errors";
import { formatCurrency } from "@/lib/format";
import Card from "@/components/ui/Card";
import Badge from "@/components/ui/Badge";
import { AgregarBroker } from "./BrokerForms";
import { BROKERS_EDITAN, COLOCACION_EDITAN } from "./roles";

type Colocacion = { totalColocado: number; numOperaciones: number };

export default async function BackofficeBrokersPage() {
  const session = await getAdminSession();
  const puedeEditar = hasRole(session, BROKERS_EDITAN);
  const puedeCapturar = hasRole(session, COLOCACION_EDITAN);

  let brokers: Broker[];
  let estatus: Awaited<ReturnType<typeof getBrokerStatusMap>>;
  let colocacion: Map<string, Colocacion>;
  try {
    const [b, s, lb] = await Promise.all([listBrokers(), getBrokerStatusMap(), getLeaderboard()]);
    [brokers, estatus] = [b, s];
    colocacion = new Map(lb.ranking.map((r) => [r.brokerId, { totalColocado: r.totalColocado, numOperaciones: r.numOperaciones }]));
  } catch (e) {
    const c = codigoDeError("brokers: listado", e);
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-red-700">
        No pudimos cargar el listado de brokers en este momento. (código {c})
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Brokers</h1>
          <p className="text-sm text-finbra-gray">{brokers.length === 1 ? "1 broker dado de alta" : `${brokers.length} brokers dados de alta`}</p>
        </div>
        {puedeCapturar && (
          <Link href="/backoffice/brokers/colocacion" className="rounded-lg border border-finbra-purple/30 px-4 py-2 text-sm font-semibold text-finbra-purple-700 hover:bg-finbra-purple/5">
            Carga de colocación
          </Link>
        )}
      </div>

      {puedeEditar && <AgregarBroker />}

      {brokers.length === 0 ? (
        <Card>
          <p className="text-sm text-finbra-gray">Todavía no hay brokers dados de alta. {puedeEditar ? "Usa “Agregar broker” o la carga masiva." : ""}</p>
        </Card>
      ) : (
        <Card className="overflow-x-auto p-0">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead>
              <tr className="border-b border-black/5 text-xs uppercase tracking-wide text-finbra-gray">
                <th scope="col" className="px-6 py-3">Broker</th>
                <th scope="col" className="px-6 py-3">ID</th>
                <th scope="col" className="px-6 py-3">Teléfono</th>
                <th scope="col" className="px-6 py-3">Colocado</th>
                <th scope="col" className="px-6 py-3">Operaciones</th>
                <th scope="col" className="px-6 py-3"><span className="sr-only">Acciones</span></th>
              </tr>
            </thead>
            <tbody>
              {brokers.map((b) => {
                const c = colocacion.get(b.id);
                return (
                  <tr key={b.id} className="border-b border-black/5 last:border-0">
                    <td className="px-6 py-4">
                      <p className="font-medium">
                        {b.nombre}
                        {estatus[b.id] === "suspendido" && <Badge variant="warning" className="ml-2">suspendido</Badge>}
                      </p>
                      <p className="text-xs text-finbra-gray">{b.email}</p>
                    </td>
                    <td className="px-6 py-4 text-finbra-gray">{b.id}</td>
                    <td className="px-6 py-4 text-finbra-gray">{b.telefono ?? "—"}</td>
                    <td className="px-6 py-4 font-semibold">{formatCurrency(c?.totalColocado ?? 0)}</td>
                    <td className="px-6 py-4">{c?.numOperaciones ?? 0}</td>
                    <td className="px-6 py-4 text-right">
                      <Link href={`/backoffice/brokers/${b.id}`} className="text-sm font-semibold text-finbra-purple hover:underline">
                        Ver perfil →
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
