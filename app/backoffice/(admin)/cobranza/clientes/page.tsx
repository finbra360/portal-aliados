import Link from "next/link";
import { getAdminSession } from "@/lib/get-admin-session";
import { COBRANZA_ROLES, hasRole } from "@/lib/rbac";
import { getClientsList, getPhotoStatus } from "@/lib/db/collections";
import { FILTROS, type ClientFilter } from "@/lib/collections/clients-list";
import { formatFecha, formatMoney, formatTelefono } from "@/lib/format";
import Card from "@/components/ui/Card";
import EmptyState from "@/components/ui/EmptyState";
import { IconListChecks } from "@/components/ui/icons";
import PhotoBanner from "../PhotoBanner";
import { codigoDeError } from "@/lib/collections/errors";

const BASE = "/backoffice/cobranza/clientes";
const esFiltro = (f: string | undefined): f is ClientFilter => FILTROS.some((x) => x.value === f);

function href(params: { filtro?: string; q?: string }) {
  const s = new URLSearchParams();
  if (params.filtro && params.filtro !== "todos") s.set("filtro", params.filtro);
  if (params.q) s.set("q", params.q);
  const qs = s.toString();
  return qs ? `${BASE}?${qs}` : BASE;
}

export default async function CobranzaClientesPage({ searchParams }: { searchParams: Promise<{ filtro?: string; q?: string }> }) {
  if (!hasRole(await getAdminSession(), COBRANZA_ROLES)) return null;
  const sp = await searchParams;
  const filtro: ClientFilter = esFiltro(sp.filtro) ? sp.filtro : "todos";
  const q = (sp.q ?? "").slice(0, 100);

  let status: Awaited<ReturnType<typeof getPhotoStatus>>;
  let data: Awaited<ReturnType<typeof getClientsList>>;
  try {
    status = await getPhotoStatus();
    data = await getClientsList(status.fechaCorte, { filtro, q });
  } catch (e) {
    const c = codigoDeError("clientes", e);
    return <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-red-700">No pudimos cargar la lista de clientes en este momento. <span className="text-sm opacity-70">(código {c})</span></div>;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Clientes</h1>
        <p className="mt-1 text-sm text-finbra-gray">
          Todos los clientes registrados en SIAC ({data.total}). Da clic en un cliente para ver su perfil y elegir a quién se le mandan los recordatorios.
        </p>
      </div>
      <PhotoBanner status={status} />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          {FILTROS.map((f) => (
            <Link
              key={f.value}
              href={href({ filtro: f.value, q })}
              className={`rounded-full px-4 py-1.5 text-sm font-medium ${
                filtro === f.value ? "bg-finbra-purple text-white" : "bg-black/5 text-finbra-gray hover:bg-black/10"
              }`}
            >
              {f.label} <span className="opacity-70">{data.conteos[f.value]}</span>
            </Link>
          ))}
        </div>
        <form action={BASE} method="get" className="flex gap-2">
          {filtro !== "todos" && <input type="hidden" name="filtro" value={filtro} />}
          <label htmlFor="buscar-cliente" className="sr-only">Buscar cliente</label>
          <input
            id="buscar-cliente"
            name="q"
            defaultValue={q}
            placeholder="Nombre o número de cliente"
            className="w-64 max-w-full rounded-lg border border-black/10 bg-white px-3 py-1.5 text-sm"
          />
          <button type="submit" className="rounded-lg bg-finbra-purple px-4 py-1.5 text-sm font-semibold text-white hover:bg-finbra-purple/90">
            Buscar
          </button>
          {q && (
            <Link href={href({ filtro })} className="rounded-lg px-3 py-1.5 text-sm text-finbra-gray hover:bg-black/5">
              Limpiar
            </Link>
          )}
        </form>
      </div>

      {data.items.length === 0 ? (
        <EmptyState
          icon={<IconListChecks />}
          title={data.total === 0 ? "Todavía no hay clientes" : "Ningún cliente coincide"}
          description={data.total === 0 ? "Los clientes aparecen con la primera foto de SIAC." : "Prueba con otro filtro o con otra búsqueda."}
        />
      ) : (
        <Card className="overflow-x-auto p-0">
          <table className="w-full min-w-[900px] text-left text-sm">
            <thead>
              <tr className="border-b border-black/5 text-xs uppercase tracking-wide text-finbra-gray">
                <th className="px-4 py-3">Cliente</th>
                <th className="px-4 py-3 text-right">Créditos</th>
                <th className="px-4 py-3 text-right">Adeudo</th>
                <th className="px-4 py-3 text-right">Vencido</th>
                <th className="px-4 py-3">Atraso</th>
                <th className="px-4 py-3">Recordatorios a</th>
                <th className="px-4 py-3">Último pago</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((c) => (
                <tr key={c.clientId} className="border-b border-black/5 align-top last:border-0">
                  <td className="px-4 py-3">
                    <Link href={`${BASE}/${c.clientId}`} className="font-medium text-finbra-purple hover:underline">
                      {c.nombre}
                    </Link>
                    <p className="font-mono text-xs text-finbra-gray">{c.numeroCliente}</p>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {c.juridico && <span className="rounded-full bg-black/5 px-2 py-0.5 text-xs text-finbra-gray">Jurídico</span>}
                      {c.pausaHasta && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-800">Pausado al {formatFecha(c.pausaHasta)}</span>}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">{c.creditosActivos}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{formatMoney(c.adeudo)}</td>
                  <td className={`px-4 py-3 text-right tabular-nums ${c.enMora ? "font-semibold text-red-700" : ""}`}>{formatMoney(c.vencido)}</td>
                  <td className="whitespace-nowrap px-4 py-3">{c.maxAtraso ? `${c.maxAtraso} días` : c.creditosActivos ? "Al corriente" : "—"}</td>
                  <td className="px-4 py-3">
                    {c.recordatorios.telefono ? (
                      <>
                        <span className="whitespace-nowrap">{formatTelefono(c.recordatorios.telefono)}</span>
                        <span className="block text-xs text-finbra-gray">
                          {c.recordatorios.nombre ? `${c.recordatorios.nombre} · ` : ""}
                          {c.recordatorios.origen === "equipo" ? "elegido por el equipo" : "sugerido por SIAC"}
                        </span>
                      </>
                    ) : c.creditosActivos ? (
                      <span className="text-xs text-amber-800">Sin WhatsApp válido</span>
                    ) : (
                      <span className="text-finbra-gray">—</span>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-finbra-gray">{formatFecha(c.ultimoPago)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
