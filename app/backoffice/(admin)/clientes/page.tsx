import Link from "next/link";
import { getAdminSession } from "@/lib/get-admin-session";
import { puede } from "@/lib/permisos";
import { getPhotoStatus } from "@/lib/db/collections";
import { getEmpresasLista, listEjecutivos } from "@/lib/db/empresas";
import { FILTROS_EMPRESA, ORDENES_EMPRESA, type EmpresaFilter, type EmpresaOrder } from "@/lib/clientes/lista";
import { codigoDeError } from "@/lib/collections/errors";
import { formatFecha, formatMoney } from "@/lib/format";
import Card from "@/components/ui/Card";
import EmptyState from "@/components/ui/EmptyState";
import { IconBuilding } from "@/components/ui/icons";
import PhotoBanner from "../cobranza/PhotoBanner";
import OrdenTh from "../cobranza/OrdenTh";
import SemaforoPill from "../cobranza/SemaforoPill";
import EtapaChip from "./EtapaChip";
import SaludChip from "./SaludChip";
import AsignarEjecutivo, { FORM_ASIGNAR } from "./AsignarEjecutivo";

const BASE = "/backoffice/clientes";
const esFiltro = (f: string | undefined): f is EmpresaFilter => FILTROS_EMPRESA.some((x) => x.value === f);
const esOrden = (o: string | undefined): o is EmpresaOrder => ORDENES_EMPRESA.some((x) => x.value === o);

function href(params: { filtro?: string; q?: string; orden?: EmpresaOrder }) {
  const s = new URLSearchParams();
  if (params.filtro && params.filtro !== "todos") s.set("filtro", params.filtro);
  if (params.q) s.set("q", params.q);
  if (params.orden && params.orden !== "nombre") s.set("orden", params.orden);
  const qs = s.toString();
  return qs ? `${BASE}?${qs}` : BASE;
}

export default async function ClientesPage({ searchParams }: { searchParams: Promise<{ filtro?: string; q?: string; orden?: string }> }) {
  const session = await getAdminSession();
  if (!puede(session, "cartera.ver")) {
    return <EmptyState title="No tienes acceso a Clientes" description="Tu rol no puede ver la cartera. Si la necesitas, pídele a un Super Admin que cambie tu rol en Usuarios." />;
  }
  const sp = await searchParams;
  const filtro: EmpresaFilter = esFiltro(sp.filtro) ? sp.filtro : "todos";
  const q = (sp.q ?? "").slice(0, 100);
  const orden: EmpresaOrder = esOrden(sp.orden) ? sp.orden : "nombre";

  const puedeEditar = puede(session, "clientes.editar");
  let status: Awaited<ReturnType<typeof getPhotoStatus>>;
  let data: Awaited<ReturnType<typeof getEmpresasLista>>;
  let ejecutivos: Awaited<ReturnType<typeof listEjecutivos>> = [];
  try {
    status = await getPhotoStatus();
    [data, ejecutivos] = await Promise.all([
      getEmpresasLista(status.fechaCorte, { filtro, q, orden, yo: session.email }),
      puedeEditar ? listEjecutivos() : Promise.resolve([]),
    ]);
  } catch (e) {
    const c = codigoDeError("clientes 360", e);
    return <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-red-700">No pudimos cargar la lista de clientes en este momento. <span className="text-sm opacity-70">(código {c})</span></div>;
  }

  const th = (o: EmpresaOrder, label: string, titulo: string, direccion: "asc" | "desc", alinear?: "right") => (
    <OrdenTh label={label} titulo={titulo} direccion={direccion} alinear={alinear} activo={orden === o} href={href({ filtro, q, orden: o })} />
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Clientes</h1>
        <p className="mt-1 text-sm text-finbra-gray">
          Una fila por empresa ({data.total}), con sus créditos de SIAC. Adeudo total {formatMoney(data.totales.adeudo)} · vencido {formatMoney(data.totales.vencido)}.
        </p>
      </div>
      <PhotoBanner status={status} />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          {FILTROS_EMPRESA.map((f) => (
            <Link
              key={f.value}
              href={href({
                filtro: f.value,
                q,
                orden: orden !== "nombre" ? orden : f.value === "por_liquidar" ? "termino" : f.value === "riesgo" || f.value === "atencion" ? "salud" : orden,
              })}
              className={`rounded-full px-4 py-1.5 text-sm font-medium ${filtro === f.value ? "bg-finbra-purple text-white" : "bg-black/5 text-finbra-gray hover:bg-black/10"}`}
            >
              {f.label} <span className="font-normal">({data.conteos[f.value]})</span>
            </Link>
          ))}
        </div>
        <form action={BASE} method="get" className="flex gap-2">
          {filtro !== "todos" && <input type="hidden" name="filtro" value={filtro} />}
          {orden !== "nombre" && <input type="hidden" name="orden" value={orden} />}
          <label htmlFor="buscar-empresa" className="sr-only">Buscar cliente</label>
          <input
            id="buscar-empresa"
            name="q"
            defaultValue={q}
            placeholder="Nombre, RFC, no. de cliente o crédito"
            className="w-72 max-w-full rounded-lg border border-black/10 bg-white px-3 py-1.5 text-sm"
          />
          <button type="submit" className="rounded-lg bg-finbra-purple px-4 py-1.5 text-sm font-semibold text-white hover:bg-finbra-purple/90">
            Buscar
          </button>
          {q && (
            <Link href={href({ filtro, orden })} className="rounded-lg px-3 py-1.5 text-sm text-finbra-gray hover:bg-black/5">
              Limpiar
            </Link>
          )}
        </form>
      </div>

      {puedeEditar && <AsignarEjecutivo ejecutivos={ejecutivos} visibles={data.items.length} />}

      {data.items.length === 0 ? (
        <EmptyState
          icon={<IconBuilding />}
          title={data.total === 0 ? "Todavía no hay clientes" : "Ningún cliente coincide"}
          description={data.total === 0 ? "Cada cliente de SIAC aparece aquí con su empresa después de la foto diaria." : "Prueba con otro filtro o con otra búsqueda."}
        />
      ) : (
        <Card className="overflow-x-auto p-0">
          <table className="w-full min-w-[1300px] text-left text-sm">
            <thead>
              <tr className="border-b border-black/5 text-xs uppercase tracking-wide text-finbra-gray">
                {puedeEditar && (
                  <th scope="col" className="w-10 py-3 pl-4">
                    <span className="sr-only">Elegir</span>
                  </th>
                )}
                {th("nombre", "Cliente", "nombre, de la A a la Z", "asc")}
                {th("salud", "Salud", "la peor salud primero", "asc")}
                <th scope="col" className="px-4 py-3">Ejecutivo</th>
                <th scope="col" className="px-4 py-3 text-right">Créditos</th>
                {th("adeudo", "Adeudo", "mayor adeudo", "desc", "right")}
                {th("vencido", "Vencido", "mayor vencido", "desc", "right")}
                <th scope="col" className="px-4 py-3">Historial de pago</th>
                {th("proximo", "Próximo pago", "el pago más cercano", "asc")}
                {th("termino", "Fin de plazo", "el que termina antes", "asc")}
                <th scope="col" className="px-4 py-3">Etapa</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((e) => (
                <tr key={e.empresaId} className="border-b border-black/5 align-top last:border-0">
                  {puedeEditar && (
                    <td className="py-3 pl-4">
                      <input type="checkbox" name="empresa" value={e.empresaId} form={FORM_ASIGNAR} aria-label={`Elegir ${e.nombre}`} className="mt-0.5 h-4 w-4 accent-finbra-purple" />
                    </td>
                  )}
                  <td className="px-4 py-3">
                    <Link href={`${BASE}/${e.empresaId}`} className="font-medium text-finbra-purple hover:underline">
                      {e.nombre}
                    </Link>
                    <p className="text-xs text-finbra-gray">
                      {e.rfc ? <span className="font-mono">{e.rfc}</span> : <span className="text-amber-800">Sin RFC</span>}
                      {e.industria && <> · {e.industria}</>}
                    </p>
                    {e.numerosCliente.length > 0 && <p className="font-mono text-xs text-finbra-gray">{e.numerosCliente.join(", ")}</p>}
                  </td>
                  <td className="px-4 py-3">
                    <SaludChip salud={e.salud} />
                    {e.salud && e.salud.razones.length > 0 && (
                      <p className="mt-1 max-w-48 text-xs text-finbra-gray">
                        {e.salud.razones[0].texto}
                        {e.salud.razones.length > 1 && ` y ${e.salud.razones.length - 1} más`}
                      </p>
                    )}
                  </td>
                  <td className="px-4 py-3">{e.ejecutivoNombre ?? <span className="text-xs text-amber-800">Sin asignar</span>}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{e.creditosVigentes}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{formatMoney(e.adeudo)}</td>
                  <td className={`px-4 py-3 text-right tabular-nums ${e.enMora ? "font-semibold text-red-700" : ""}`}>{formatMoney(e.vencido)}</td>
                  <td className="px-4 py-3">
                    <SemaforoPill semaforo={e.semaforo} historial={e.historial} />
                  </td>
                  <td className="whitespace-nowrap px-4 py-3">
                    {e.proximoPago ? formatFecha(e.proximoPago.fecha) : "—"}
                    {e.proximoPago?.monto != null && <span className="block text-xs text-finbra-gray">{formatMoney(e.proximoPago.monto)}</span>}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3">
                    {e.finPlazo ? (
                      <>
                        {formatFecha(e.finPlazo.fecha)}
                        <span className={`block text-xs ${e.etapa === "por_liquidar" ? "font-semibold text-finbra-purple-700" : "text-finbra-gray"}`}>
                          {e.finPlazo.dias === 0 ? "termina hoy" : `en ${e.finPlazo.dias} ${e.finPlazo.dias === 1 ? "día" : "días"}`}
                        </span>
                      </>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <EtapaChip etapa={e.etapa} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
