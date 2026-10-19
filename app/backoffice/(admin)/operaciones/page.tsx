import { listOperations } from "@/lib/db/operations";
import { getLeaderboard } from "@/lib/db/colocacion";
import { formatCurrency } from "@/lib/format";
import Card from "@/components/ui/Card";
import EmptyState from "@/components/ui/EmptyState";
import { IconListChecks } from "@/components/ui/icons";
import { createOperationAction, setOperationMessageAction, updateOperationStageAction } from "./actions";
import StageSelect from "./StageSelect";

export default async function BackofficeOperacionesPage() {
  let brokers: Awaited<ReturnType<typeof getLeaderboard>>["ranking"] = [];
  let operations: Awaited<ReturnType<typeof listOperations>> = [];
  let loadError = false;

  try {
    const [leaderboard, ops] = await Promise.all([getLeaderboard(), listOperations()]);
    brokers = leaderboard.ranking;
    operations = ops;
  } catch {
    loadError = true;
  }

  if (loadError) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-red-700">
        No pudimos cargar las operaciones en este momento.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Operaciones</h1>

      <Card>
        <p className="mb-3 text-sm font-medium text-finbra-gray">Registrar nueva solicitud</p>
        <form action={createOperationAction} className="grid gap-3 sm:grid-cols-4">
          <select name="brokerId" required aria-label="Broker" className="rounded-lg border border-black/10 px-3 py-2 text-sm">
            <option value="">Broker…</option>
            {brokers.map((b) => (
              <option key={b.brokerId} value={b.brokerId}>
                {b.nombre}
              </option>
            ))}
          </select>
          <input
            name="clienteReferencia"
            required
            placeholder="Referencia del cliente"
            className="rounded-lg border border-black/10 px-3 py-2 text-sm"
          />
          <input
            name="montoSolicitado"
            type="number"
            required
            min={1}
            placeholder="Monto solicitado"
            className="rounded-lg border border-black/10 px-3 py-2 text-sm"
          />
          <button type="submit" className="rounded-lg bg-finbra-purple px-4 py-2 text-sm font-bold text-white">
            Registrar
          </button>
        </form>
      </Card>

      {operations.length === 0 ? (
        <EmptyState icon={<IconListChecks />} title="Sin operaciones registradas" description="Registra la primera solicitud arriba." />
      ) : (
        <Card className="overflow-x-auto p-0">
          <table className="w-full min-w-[900px] text-left text-sm">
            <thead>
              <tr className="border-b border-black/5 text-xs uppercase tracking-wide text-finbra-gray">
                <th scope="col" className="px-6 py-3">Broker</th>
                <th scope="col" className="px-6 py-3">Cliente</th>
                <th scope="col" className="px-6 py-3">Monto</th>
                <th scope="col" className="px-6 py-3">Etapa</th>
                <th scope="col" className="px-6 py-3">Mensaje para el broker</th>
                <th scope="col" className="px-6 py-3">Actualizado</th>
              </tr>
            </thead>
            <tbody>
              {operations.map((op) => {
                const broker = brokers.find((b) => b.brokerId === op.brokerId);
                return (
                  <tr key={op.id} className="border-b border-black/5 last:border-0">
                    <td className="px-6 py-4">{broker?.nombre ?? op.brokerId}</td>
                    <td className="px-6 py-4">{op.clienteReferencia}</td>
                    <td className="px-6 py-4 font-semibold">{formatCurrency(op.montoSolicitado)}</td>
                    <td className="px-6 py-4">
                      <StageSelect id={op.id} current={op.etapa} action={updateOperationStageAction} />
                    </td>
                    <td className="px-6 py-4">
                      <form action={setOperationMessageAction.bind(null, op.id)} className="flex gap-2">
                        <input
                          name="mensaje"
                          defaultValue={op.mensajeBroker ?? ""}
                          maxLength={500}
                          placeholder="Ej. Falta comprobante de domicilio"
                          aria-label={`Mensaje para el broker sobre ${op.clienteReferencia}`}
                          className="w-56 rounded-lg border border-black/10 px-2 py-1 text-xs"
                        />
                        <button type="submit" className="text-xs font-semibold text-finbra-purple hover:underline">
                          Guardar
                        </button>
                      </form>
                    </td>
                    <td className="px-6 py-4 text-xs text-finbra-gray">{new Date(op.updatedAt).toLocaleDateString("es-MX")}</td>
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
