import Link from "next/link";
import { getAdminSession } from "@/lib/get-admin-session";
import { puede } from "@/lib/permisos";
import { codigoDeError } from "@/lib/collections/errors";
import { fechaMexico } from "@/lib/collections/rules";
import { formatFecha, formatMoney } from "@/lib/format";
import { getNegocios, hayNegocios, type Negocio } from "@/lib/db/negocios";
import { CIERRES, ETAPAS_ABIERTAS, ETAPAS_NEGOCIO, ETIQUETA_ETAPA, ORIGENES_NEGOCIO, PRODUCTOS, diasEnEtapa, totalesPorEtapa, type EtapaNegocio } from "@/lib/clientes/negocios";
import Card from "@/components/ui/Card";
import EmptyState from "@/components/ui/EmptyState";
import EtapaNegocioChip from "./EtapaNegocioChip";
import TableroNegocios from "./TableroNegocios";

const BASE = "/backoffice/negocios";
type Vista = "tablero" | "lista";
type Filtro = "todos" | "mios" | "brokers";

function href(p: { vista?: Vista; filtro?: Filtro; etapa?: string }) {
  const s = new URLSearchParams();
  if (p.vista && p.vista !== "tablero") s.set("vista", p.vista);
  if (p.filtro && p.filtro !== "todos") s.set("filtro", p.filtro);
  if (p.etapa) s.set("etapa", p.etapa);
  const qs = s.toString();
  return qs ? `${BASE}?${qs}` : BASE;
}

const pestana = (activa: boolean) =>
  `rounded-full px-4 py-1.5 text-sm font-medium ${activa ? "bg-finbra-purple text-white" : "bg-black/5 text-finbra-gray hover:bg-black/10"}`;

export default async function NegociosPage({ searchParams }: { searchParams: Promise<{ vista?: string; filtro?: string; etapa?: string; origen?: string }> }) {
  const session = await getAdminSession();
  if (!puede(session, "originacion.ver")) {
    return <EmptyState title="No tienes acceso a Negocios" description="Tu rol no puede ver la originación. Si la necesitas, pídele a un Super Admin que cambie tu rol en Usuarios." />;
  }
  const sp = await searchParams;
  const vista: Vista = sp.vista === "lista" ? "lista" : "tablero";
  // ?origen=broker es a donde lleva la página vieja de Operaciones.
  const filtro: Filtro = sp.filtro === "mios" ? "mios" : sp.filtro === "brokers" || sp.origen === "broker" ? "brokers" : "todos";
  const etapa = ETAPAS_NEGOCIO.some((e) => e.value === sp.etapa) ? (sp.etapa as EtapaNegocio) : null;
  const puedeOperar = puede(session, "originacion.operar");
  const hoy = fechaMexico();

  let negocios: Negocio[];
  try {
    if (!(await hayNegocios())) {
      return <EmptyState title="Falta preparar la base de datos" description="Corre lib/db/crm-schema.sql y después security.sql en Supabase para activar los negocios de crédito." />;
    }
    // El tablero muestra los cierres del último año; la lista, todos (también los traídos de HubSpot).
    negocios = await getNegocios(vista === "lista" ? { diasCerrados: 36_500 } : {});
  } catch (e) {
    const c = codigoDeError("originación: negocios", e);
    return <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-red-700">No pudimos cargar los negocios. <span className="text-sm opacity-70">(código {c})</span></div>;
  }

  const visibles =
    filtro === "mios"
      ? negocios.filter((n) => n.responsableEmail === session.email)
      : filtro === "brokers"
        ? negocios.filter((n) => n.brokerId || n.origen === "broker")
        : negocios;
  const totales = totalesPorEtapa(visibles);
  const abiertos = visibles.filter((n) => ETAPAS_ABIERTAS.includes(n.etapa));
  const montoAbierto = abiertos.reduce((s, n) => s + (n.montoEstimado ?? 0), 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Negocios</h1>
          <p className="mt-1 text-sm text-finbra-gray">
            {abiertos.length} {abiertos.length === 1 ? "negocio abierto" : "negocios abiertos"} · {formatMoney(montoAbierto)} en monto estimado. Del primer contacto al crédito dispersado en SIAC.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {puede(session, "originacion.importar") && (
            <Link href={`${BASE}/importar`} className="rounded-lg border border-black/10 px-4 py-2 text-sm font-semibold text-finbra-gray hover:bg-black/5">
              Importar de HubSpot
            </Link>
          )}
          <Link href={`${BASE}/metricas`} className="rounded-lg border border-finbra-purple px-4 py-2 text-sm font-semibold text-finbra-purple hover:bg-finbra-purple/5">
            Métricas
          </Link>
          {puedeOperar && (
            <Link href={`${BASE}/nuevo`} className="rounded-lg bg-finbra-purple px-4 py-2 text-sm font-semibold text-white hover:bg-finbra-purple/90">
              Nuevo negocio
            </Link>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          <Link href={href({ vista, filtro: "todos", etapa: etapa ?? undefined })} className={pestana(filtro === "todos")}>Todos</Link>
          <Link href={href({ vista, filtro: "mios", etapa: etapa ?? undefined })} className={pestana(filtro === "mios")}>Mis negocios</Link>
          <Link href={href({ vista, filtro: "brokers", etapa: etapa ?? undefined })} className={pestana(filtro === "brokers")}>De brokers</Link>
        </div>
        <div className="flex gap-1 rounded-lg bg-black/5 p-1 text-sm">
          <Link href={href({ vista: "tablero", filtro })} aria-current={vista === "tablero" ? "page" : undefined} className={`rounded-md px-3 py-1 ${vista === "tablero" ? "bg-white font-semibold shadow-sm" : "text-finbra-gray"}`}>Tablero</Link>
          <Link href={href({ vista: "lista", filtro })} aria-current={vista === "lista" ? "page" : undefined} className={`rounded-md px-3 py-1 ${vista === "lista" ? "bg-white font-semibold shadow-sm" : "text-finbra-gray"}`}>Lista</Link>
        </div>
      </div>

      {negocios.length === 0 ? (
        <EmptyState title="Todavía no hay negocios" description="Da de alta el primero con «Nuevo negocio»: puede ser de una empresa de Clientes o de una empresa nueva." />
      ) : vista === "tablero" ? (
        <>
          <TableroNegocios negocios={visibles.filter((n) => ETAPAS_ABIERTAS.includes(n.etapa))} hoy={hoy} puedeOperar={puedeOperar} />
          <p className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-finbra-gray">
            {(["dispersado", ...CIERRES] as EtapaNegocio[]).map((e) => (
              <Link key={e} href={href({ vista: "lista", filtro, etapa: e })} className="hover:text-finbra-purple hover:underline">
                {ETIQUETA_ETAPA[e]}: <span className="font-semibold tabular-nums">{totales[e].n}</span>
                {e === "dispersado" && totales[e].n > 0 && <> · {formatMoney(totales[e].monto)}</>}
              </Link>
            ))}
            <span className="text-xs">Dispersados, pospuestos y rechazados del último año.</span>
          </p>
        </>
      ) : (
        <>
          <div className="flex flex-wrap gap-2">
            <Link href={href({ vista: "lista", filtro })} className={pestana(!etapa)}>Todas ({visibles.length})</Link>
            {ETAPAS_NEGOCIO.filter((e) => totales[e.value].n > 0).map((e) => (
              <Link key={e.value} href={href({ vista: "lista", filtro, etapa: e.value })} className={pestana(etapa === e.value)}>
                {e.label} ({totales[e.value].n})
              </Link>
            ))}
          </div>
          <Card className="overflow-x-auto p-0">
            <table className="w-full min-w-[1000px] text-left text-sm">
              <thead>
                <tr className="border-b border-black/5 text-xs uppercase tracking-wide text-finbra-gray">
                  <th scope="col" className="px-4 py-3">Empresa</th>
                  <th scope="col" className="px-4 py-3">Etapa</th>
                  <th scope="col" className="px-4 py-3">Producto</th>
                  <th scope="col" className="px-4 py-3 text-right">Monto estimado</th>
                  <th scope="col" className="px-4 py-3">Origen</th>
                  <th scope="col" className="px-4 py-3">Responsable</th>
                  <th scope="col" className="px-4 py-3 text-right">Días en etapa</th>
                  <th scope="col" className="px-4 py-3">Alta</th>
                </tr>
              </thead>
              <tbody>
                {visibles
                  .filter((n) => !etapa || n.etapa === etapa)
                  .map((n) => (
                    <tr key={n.id} className="border-b border-black/5 align-top last:border-0">
                      <td className="px-4 py-3">
                        <Link href={`${BASE}/${n.id}`} className="font-medium text-finbra-purple hover:underline">{n.empresa}</Link>
                        {!n.esCliente && <span className="ml-2 text-xs text-finbra-gray">Prospecto</span>}
                        {n.motivoCierre && <p className="text-xs text-finbra-gray">{n.motivoCierre}</p>}
                        {n.etapa === "pospuesto" && n.recontactarEl && (
                          <p className={`text-xs ${n.recontactarEl <= hoy ? "font-semibold text-amber-800" : "text-finbra-gray"}`}>Volver a contactar el {formatFecha(n.recontactarEl)}</p>
                        )}
                      </td>
                      <td className="px-4 py-3"><EtapaNegocioChip etapa={n.etapa} /></td>
                      <td className="px-4 py-3">
                        {n.producto ? PRODUCTOS[n.producto] : <span className="text-finbra-gray">—</span>}
                        {n.plazoMeses && <span className="block text-xs text-finbra-gray">{n.plazoMeses} meses</span>}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">{n.montoEstimado !== null ? formatMoney(n.montoEstimado) : "—"}</td>
                      <td className="px-4 py-3">{ORIGENES_NEGOCIO[n.origen]}</td>
                      <td className="px-4 py-3">{n.responsableNombre ?? <span className="text-xs text-amber-800">Sin responsable</span>}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{diasEnEtapa(n.etapaDesde, hoy)}</td>
                      <td className="whitespace-nowrap px-4 py-3">{formatFecha(n.createdAt.slice(0, 10))}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </Card>
        </>
      )}
    </div>
  );
}
