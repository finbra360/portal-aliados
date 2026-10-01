import { getAdminSession } from "@/lib/get-admin-session";
import { COBRANZA_ROLES, hasRole } from "@/lib/rbac";
import { getPhotoStatus, getWorkQueue } from "@/lib/db/collections";
import type { QueueItem } from "@/lib/collections/queue";
import { formatFecha, formatMoney } from "@/lib/format";
import Card from "@/components/ui/Card";
import EmptyState from "@/components/ui/EmptyState";
import { IconListChecks } from "@/components/ui/icons";
import PhotoBanner from "../PhotoBanner";

const NIVEL_ESTILO: Record<number, string> = {
  1: "bg-red-100 text-red-700",
  2: "bg-red-100 text-red-700",
  3: "bg-amber-100 text-amber-800",
  4: "bg-amber-100 text-amber-800",
  5: "bg-black/5 text-finbra-gray",
  6: "bg-black/5 text-finbra-gray",
};

function Creditos({ item }: { item: QueueItem }) {
  return (
    <ul className="space-y-0.5 text-xs text-finbra-gray">
      {item.creditos.map((c) => (
        <li key={c.noCredito}>
          <span className="font-mono text-black">{c.noCredito}</span> · {c.antiguedad ? `${c.antiguedad} d` : "al corriente"}
        </li>
      ))}
    </ul>
  );
}

function Tabla({ items, conNivel }: { items: QueueItem[]; conNivel: boolean }) {
  return (
    <Card className="overflow-x-auto p-0">
      <table className="w-full min-w-[860px] text-left text-sm">
        <thead>
          <tr className="border-b border-black/5 text-xs uppercase tracking-wide text-finbra-gray">
            {conNivel && <th className="px-4 py-3">#</th>}
            <th className="px-4 py-3">Cliente</th>
            <th className="px-4 py-3">Créditos</th>
            <th className="px-4 py-3 text-right">Vencido</th>
            <th className="px-4 py-3">Por qué</th>
            <th className="px-4 py-3">Qué sigue</th>
            <th className="px-4 py-3">Última gestión</th>
          </tr>
        </thead>
        <tbody>
          {items.map((i, idx) => (
            <tr key={i.clientId} className="border-b border-black/5 align-top last:border-0">
              {conNivel && (
                <td className="px-4 py-3">
                  <span className={`inline-grid h-6 min-w-6 place-items-center rounded-full px-1.5 text-xs font-bold ${NIVEL_ESTILO[i.nivel ?? 6]}`}>
                    {idx + 1}
                  </span>
                </td>
              )}
              <td className="px-4 py-3">
                <p className="font-medium">{i.cliente}</p>
                <p className="font-mono text-xs text-finbra-gray">{i.numeroCliente}</p>
              </td>
              <td className="px-4 py-3">
                <Creditos item={i} />
              </td>
              <td className="whitespace-nowrap px-4 py-3 text-right font-semibold tabular-nums">
                {formatMoney(i.totalVencido)}
                <span className="block text-xs font-normal text-finbra-gray">{i.maxAntiguedad} días de atraso</span>
              </td>
              <td className="px-4 py-3">
                <ul className="space-y-1">
                  {i.motivos.map((m) => (
                    <li key={m} className={m.startsWith("Sin teléfono") ? "text-xs text-amber-800" : ""}>
                      {m}
                    </li>
                  ))}
                </ul>
              </td>
              <td className="px-4 py-3 font-medium text-finbra-purple">{i.accion}</td>
              <td className="whitespace-nowrap px-4 py-3 text-finbra-gray">{i.ultimaGestion ? formatFecha(i.ultimaGestion) : "Nunca"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

export default async function CobranzaColaPage() {
  if (!hasRole(await getAdminSession(), COBRANZA_ROLES)) return null;

  let status: Awaited<ReturnType<typeof getPhotoStatus>>;
  let items: QueueItem[] = [];
  try {
    status = await getPhotoStatus();
    if (status.fechaCorte) items = (await getWorkQueue(status.fechaCorte)).items;
  } catch {
    return <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-red-700">No pudimos cargar la cola de trabajo en este momento.</div>;
  }

  const cola = items.filter((i) => i.lugar === "cola");
  const espera = items.filter((i) => i.lugar === "espera");
  const juridico = items.filter((i) => i.lugar === "juridico");
  const suma = (xs: QueueItem[]) => formatMoney(xs.reduce((s, i) => s + i.totalVencido, 0));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Cola de trabajo</h1>
        <p className="mt-1 text-sm text-finbra-gray">
          A quién contactar primero. El orden sale de reglas fijas: promesa incumplida, otra mensualidad vencida, más de 60 días de
          atraso, recién entrado a mora, sin gestión en 7 días; dentro de cada nivel, el mayor vencido primero.
        </p>
      </div>
      <PhotoBanner status={status} />

      {!status.fechaCorte ? (
        <EmptyState icon={<IconListChecks />} title="Todavía no hay datos de cartera" description="La cola aparece con la primera foto de SIAC." />
      ) : (
        <>
          <div className="flex flex-wrap gap-3 text-sm">
            <span className="rounded-full bg-finbra-purple px-4 py-1.5 font-semibold text-white">
              Para hoy: {cola.length} · {suma(cola)}
            </span>
            <span className="rounded-full bg-black/5 px-4 py-1.5 text-finbra-gray">
              En espera: {espera.length} · {suma(espera)}
            </span>
            {juridico.length > 0 && (
              <span className="rounded-full bg-black/5 px-4 py-1.5 text-finbra-gray">
                En jurídico: {juridico.length} · {suma(juridico)}
              </span>
            )}
          </div>

          {cola.length === 0 ? (
            <EmptyState icon={<IconListChecks />} title="No hay clientes por contactar hoy" description="Nadie en mora necesita gestión según las reglas de la cola." />
          ) : (
            <Tabla items={cola} conNivel />
          )}

          {espera.length > 0 && (
            <section className="space-y-3">
              <h2 className="text-lg font-bold">En espera</h2>
              <p className="text-sm text-finbra-gray">Tienen una promesa de pago vigente o la cobranza pausada. Vuelven a la cola si la promesa vence sin pago.</p>
              <Tabla items={espera} conNivel={false} />
            </section>
          )}

          {juridico.length > 0 && (
            <section className="space-y-3">
              <h2 className="text-lg font-bold">En jurídico</h2>
              <Tabla items={juridico} conNivel={false} />
            </section>
          )}
        </>
      )}
    </div>
  );
}
