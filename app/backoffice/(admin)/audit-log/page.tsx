import { listAuditLog } from "@/lib/db/audit";
import Card from "@/components/ui/Card";
import EmptyState from "@/components/ui/EmptyState";

export default async function BackofficeAuditLogPage() {
  let entries: Awaited<ReturnType<typeof listAuditLog>> = [];
  let loadError = false;
  try {
    entries = await listAuditLog();
  } catch {
    loadError = true;
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Audit Log</h1>

      {loadError ? (
        <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-red-700">No pudimos cargar el audit log.</div>
      ) : entries.length === 0 ? (
        <EmptyState title="Sin actividad registrada todavía" description="Cada acción sensible (cambios de etapa, comisiones, brokers, usuarios) queda registrada aquí automáticamente." />
      ) : (
        <Card className="overflow-x-auto p-0">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead>
              <tr className="border-b border-black/5 text-xs uppercase tracking-wide text-finbra-gray">
                <th className="px-6 py-3">Fecha</th>
                <th className="px-6 py-3">Actor</th>
                <th className="px-6 py-3">Acción</th>
                <th className="px-6 py-3">Entidad</th>
                <th className="px-6 py-3">Detalle</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.id} className="border-b border-black/5 last:border-0">
                  <td className="px-6 py-4 text-xs text-finbra-gray">{new Date(e.createdAt).toLocaleString("es-MX")}</td>
                  <td className="px-6 py-4">{e.actorEmail}</td>
                  <td className="px-6 py-4">{e.action}</td>
                  <td className="px-6 py-4 text-finbra-gray">
                    {e.entityType}
                    {e.entityId ? ` #${e.entityId}` : ""}
                  </td>
                  <td className="px-6 py-4 text-xs text-finbra-gray">{e.metadata ? JSON.stringify(e.metadata) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
