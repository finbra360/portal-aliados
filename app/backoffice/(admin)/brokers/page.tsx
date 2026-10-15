import Link from "next/link";
import { getLeaderboard } from "@/lib/n8n";
import { listBrokers, type Broker } from "@/lib/db/brokers";
import { getBrokerStatusMap } from "@/lib/db/broker-status";
import { getAdminSession } from "@/lib/get-admin-session";
import { hasRole } from "@/lib/rbac";
import { codigoDeError } from "@/lib/collections/errors";
import { formatCurrency } from "@/lib/format";
import Card from "@/components/ui/Card";
import Badge from "@/components/ui/Badge";
import { AgregarBroker } from "./BrokerForms";
import { BROKERS_EDITAN } from "./roles";

type Colocacion = { totalColocado: number; numOperaciones: number };

export default async function BackofficeBrokersPage() {
  const puedeEditar = hasRole(await getAdminSession(), BROKERS_EDITAN);

  let brokers: Broker[];
  let estatus: Awaited<ReturnType<typeof getBrokerStatusMap>>;
  try {
    [brokers, estatus] = await Promise.all([listBrokers(), getBrokerStatusMap()]);
  } catch (e) {
    const c = codigoDeError("brokers: listado", e);
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-red-700">
        No pudimos cargar el listado de brokers en este momento. (código {c})
      </div>
    );
  }

  // La colocación sigue en el Sheet "Historial Colocacion" (vía n8n). Si n8n
  // falla, la lista se muestra igual, sin esas columnas.
  let colocacion: Map<string, Colocacion & { nombre: string }> | null = null;
  try {
    const lb = await getLeaderboard();
    colocacion = new Map(lb.ranking.map((b) => [b.brokerId, { nombre: b.nombre, totalColocado: b.totalColocado, numOperaciones: b.numOperaciones }]));
  } catch {
    colocacion = null;
  }

  // Brokers con colocación que todavía no están dados de alta aquí (vienen del
  // Sheet): se listan para que no se pierdan de vista hasta importarlos.
  const ids = new Set(brokers.map((b) => b.id));
  const faltantes = colocacion ? [...colocacion].filter(([id]) => !ids.has(id)) : [];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Brokers</h1>
          <p className="text-sm text-finbra-gray">{brokers.length === 1 ? "1 broker dado de alta" : `${brokers.length} brokers dados de alta`}</p>
        </div>
      </div>

      {puedeEditar && <AgregarBroker />}

      {colocacion === null && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          No pudimos traer la colocación de cada broker (n8n no respondió). La lista está completa; las columnas de colocación salen vacías.
        </div>
      )}

      {faltantes.length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          El historial de colocación del Sheet tiene {faltantes.length === 1 ? "un ID" : "IDs"} que no {faltantes.length === 1 ? "es" : "son"} de ningún broker de aquí:{" "}
          {faltantes.map(([id, b]) => `${b.nombre} (${id})`).join(", ")}. Si ya {faltantes.length === 1 ? "está dado" : "están dados"} de alta con su código de Lendia, su colocación
          aparecerá cuando el historial use ese código (se cambia junto con el login del portal). Si no, da de alta {faltantes.length === 1 ? "al broker" : "a cada uno"} con ese mismo ID.
        </div>
      )}

      {brokers.length === 0 ? (
        <Card>
          <p className="text-sm text-finbra-gray">Todavía no hay brokers dados de alta. {puedeEditar ? "Usa “Agregar broker” o la carga masiva." : ""}</p>
        </Card>
      ) : (
        <Card className="overflow-x-auto p-0">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead>
              <tr className="border-b border-black/5 text-xs uppercase tracking-wide text-finbra-gray">
                <th className="px-6 py-3">Broker</th>
                <th className="px-6 py-3">ID</th>
                <th className="px-6 py-3">Teléfono</th>
                <th className="px-6 py-3">Colocado</th>
                <th className="px-6 py-3">Operaciones</th>
                <th className="px-6 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {brokers.map((b) => {
                const c = colocacion?.get(b.id);
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
                    <td className="px-6 py-4 font-semibold">{colocacion ? formatCurrency(c?.totalColocado ?? 0) : "—"}</td>
                    <td className="px-6 py-4">{colocacion ? (c?.numOperaciones ?? 0) : "—"}</td>
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
