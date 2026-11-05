import Link from "next/link";
import { getAdminSession } from "@/lib/get-admin-session";
import { COBRANZA_ROLES, hasRole } from "@/lib/rbac";
import { getCreditsList, getPhotoStatus } from "@/lib/db/collections";
import {
  FILTROS_CREDITO,
  ORDENES_CREDITO,
  VENTANAS_TERMINO,
  VENTANA_TERMINO_DEFAULT,
  type CreditFilter,
  type CreditListItem,
  type CreditOrder,
  type VentanaTermino,
} from "@/lib/collections/credits-list";
import { ETAPAS } from "@/lib/collections/gestiones";
import { formatFecha, formatMoney } from "@/lib/format";
import Card from "@/components/ui/Card";
import EmptyState from "@/components/ui/EmptyState";
import ProgressBar from "@/components/ui/ProgressBar";
import { IconListChecks } from "@/components/ui/icons";
import PhotoBanner from "../PhotoBanner";
import OrdenTh from "../OrdenTh";
import { codigoDeError } from "@/lib/collections/errors";

const BASE = "/backoffice/cobranza/creditos";
const esFiltro = (f: string | undefined): f is CreditFilter => FILTROS_CREDITO.some((x) => x.value === f);
const esOrden = (o: string | undefined): o is CreditOrder => ORDENES_CREDITO.some((x) => x.value === o);
const aVentana = (v: string | undefined): VentanaTermino => VENTANAS_TERMINO.find((x) => String(x) === v) ?? VENTANA_TERMINO_DEFAULT;
const dinero = (v: number | null) => (v === null ? "—" : formatMoney(v));

function href(params: { filtro?: string; q?: string; orden?: CreditOrder; ventana?: VentanaTermino }) {
  const s = new URLSearchParams();
  if (params.filtro && params.filtro !== "activos") s.set("filtro", params.filtro);
  if (params.filtro === "por_terminar" && params.ventana && params.ventana !== VENTANA_TERMINO_DEFAULT) s.set("ventana", String(params.ventana));
  if (params.q) s.set("q", params.q);
  if (params.orden && params.orden !== "credito") s.set("orden", params.orden);
  const qs = s.toString();
  return qs ? `${BASE}?${qs}` : BASE;
}

/** Fecha de fin del plazo y cuánto falta. */
function FinDelPlazo({ c }: { c: CreditListItem }) {
  if (!c.fechaTermino || c.diasParaTermino === null) return <>—</>;
  const d = c.diasParaTermino;
  const pronto = c.enListado && d >= 0 && d <= VENTANA_TERMINO_DEFAULT;
  return (
    <>
      {formatFecha(c.fechaTermino)}
      <span className={`block text-xs ${pronto ? "font-semibold text-finbra-purple-700" : "text-finbra-gray"}`}>
        {d < 0 ? "ya terminó" : d === 0 ? "termina hoy" : d === 1 ? "en 1 día" : `en ${d} días`}
      </span>
    </>
  );
}

export default async function CobranzaCreditosPage({
  searchParams,
}: {
  searchParams: Promise<{ filtro?: string; q?: string; orden?: string; ventana?: string }>;
}) {
  if (!hasRole(await getAdminSession(), COBRANZA_ROLES)) return null;
  const sp = await searchParams;
  const filtro: CreditFilter = esFiltro(sp.filtro) ? sp.filtro : "activos";
  const q = (sp.q ?? "").slice(0, 100);
  const orden: CreditOrder = esOrden(sp.orden) ? sp.orden : "credito";
  const ventana = aVentana(sp.ventana);

  let status: Awaited<ReturnType<typeof getPhotoStatus>>;
  let data: Awaited<ReturnType<typeof getCreditsList>>;
  try {
    status = await getPhotoStatus();
    data = await getCreditsList(status.fechaCorte, { filtro, q, orden, ventana });
  } catch (e) {
    const c = codigoDeError("créditos", e);
    return <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-red-700">No pudimos cargar la lista de créditos en este momento. <span className="text-sm opacity-70">(código {c})</span></div>;
  }

  const th = (o: CreditOrder, label: string, titulo: string, direccion: "asc" | "desc", alinear?: "right") => (
    <OrdenTh label={label} titulo={titulo} direccion={direccion} alinear={alinear} activo={orden === o} href={href({ filtro, q, orden: o, ventana })} />
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Créditos</h1>
        <p className="mt-1 text-sm text-finbra-gray">
          Todos los créditos activos en SIAC ({data.total}), con los montos de la última foto. Da clic en el cliente para ver su perfil y gestiones.
        </p>
      </div>
      <PhotoBanner status={status} />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          {FILTROS_CREDITO.map((f) => (
            <Link
              key={f.value}
              // Al entrar a «Por terminar», el que termina antes va primero (si no se eligió otro orden).
              href={href({ filtro: f.value, q, ventana, orden: f.value === "por_terminar" && orden === "credito" ? "termino" : orden })}
              className={`rounded-full px-4 py-1.5 text-sm font-medium ${
                filtro === f.value ? "bg-finbra-purple text-white" : "bg-black/5 text-finbra-gray hover:bg-black/10"
              }`}
            >
              {f.value === "por_terminar" ? `Terminan en ${ventana} días` : f.label} <span className="font-normal">({data.conteos[f.value]})</span>
            </Link>
          ))}
        </div>
        <form action={BASE} method="get" className="flex gap-2">
          {filtro !== "activos" && <input type="hidden" name="filtro" value={filtro} />}
          {filtro === "por_terminar" && ventana !== VENTANA_TERMINO_DEFAULT && <input type="hidden" name="ventana" value={ventana} />}
          {orden !== "credito" && <input type="hidden" name="orden" value={orden} />}
          <label htmlFor="buscar-credito" className="sr-only">Buscar crédito</label>
          <input
            id="buscar-credito"
            name="q"
            defaultValue={q}
            placeholder="Crédito, cliente o número de cliente"
            className="w-64 max-w-full rounded-lg border border-black/10 bg-white px-3 py-1.5 text-sm"
          />
          <button type="submit" className="rounded-lg bg-finbra-purple px-4 py-1.5 text-sm font-semibold text-white hover:bg-finbra-purple/90">
            Buscar
          </button>
          {q && (
            <Link href={href({ filtro, orden, ventana })} className="rounded-lg px-3 py-1.5 text-sm text-finbra-gray hover:bg-black/5">
              Limpiar
            </Link>
          )}
        </form>
      </div>

      {filtro === "por_terminar" && (
        <div className="-mt-2 flex flex-wrap items-center gap-2 text-sm text-finbra-gray">
          <span>Fin del plazo en:</span>
          {VENTANAS_TERMINO.map((v) => (
            <Link
              key={v}
              href={href({ filtro, q, orden, ventana: v })}
              aria-current={v === ventana ? "true" : undefined}
              className={`rounded-full px-3 py-1 font-medium ${v === ventana ? "bg-finbra-purple/10 text-finbra-purple-700" : "hover:bg-black/5"}`}
            >
              {v} días
            </Link>
          ))}
          <span className="basis-full text-xs sm:basis-auto">
            Según la fecha de término del contrato en SIAC. No incluye créditos en jurídico, extrajudicial ni reestructura.
          </span>
        </div>
      )}

      {data.items.length === 0 ? (
        <EmptyState
          icon={<IconListChecks />}
          title={data.total === 0 && filtro !== "fuera" ? "Todavía no hay créditos" : "Ningún crédito coincide"}
          description={
            data.total === 0 && filtro !== "fuera"
              ? "Los créditos aparecen con la primera foto de SIAC."
              : filtro === "por_terminar"
                ? `Ningún crédito termina en los próximos ${ventana} días. Prueba con una ventana más amplia.`
                : "Prueba con otro filtro o con otra búsqueda."
          }
        />
      ) : (
        <Card className="overflow-x-auto p-0">
          <table className="w-full min-w-[1220px] text-left text-sm">
            <thead>
              <tr className="border-b border-black/5 text-xs uppercase tracking-wide text-finbra-gray">
                {th("credito", "Crédito", "número de crédito", "asc")}
                {th("cliente", "Cliente", "cliente, de la A a la Z", "asc")}
                <th scope="col" className="px-4 py-3 text-right">Otorgado</th>
                {th("adeudo", "Adeudo", "mayor adeudo", "desc", "right")}
                {th("vencido", "Vencido", "mayor vencido", "desc", "right")}
                {th("atraso", "Atraso", "más días de atraso", "desc")}
                {th("proximo", "Próximo pago", "el pago más cercano", "asc")}
                <th scope="col" className="px-4 py-3">Mensualidades</th>
                {th("termino", "Fin del plazo", "el que termina antes", "asc")}
                <th scope="col" className="px-4 py-3">Último pago</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((c) => (
                <tr key={c.creditId} className="border-b border-black/5 align-top last:border-0">
                  <td className="px-4 py-3">
                    <p className="font-mono font-semibold">{c.noCredito}</p>
                    {c.tipoCredito && <p className="text-xs text-finbra-gray">{c.tipoCredito}</p>}
                    <div className="mt-1 flex flex-wrap gap-1">
                      {c.etapaManual && c.etapaManual in ETAPAS && (
                        <span className="rounded-full bg-black/5 px-2 py-0.5 text-xs text-finbra-gray">{ETAPAS[c.etapaManual as keyof typeof ETAPAS]}</span>
                      )}
                      {!c.enListado && <span className="rounded-full bg-black/5 px-2 py-0.5 text-xs text-finbra-gray">Salió de SIAC</span>}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <Link href={`/backoffice/cobranza/clientes/${c.clientId}`} className="font-medium text-finbra-purple hover:underline">
                      {c.cliente}
                    </Link>
                    <p className="font-mono text-xs text-finbra-gray">{c.numeroCliente}</p>
                    {c.promotor && <p className="text-xs text-finbra-gray">Promotor: {c.promotor}</p>}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {dinero(c.montoCredito)}
                    {c.fechaMinistracion && <span className="block text-xs text-finbra-gray">{formatFecha(c.fechaMinistracion)}</span>}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">{dinero(c.adeudo)}</td>
                  <td className={`px-4 py-3 text-right tabular-nums ${c.enMora ? "font-semibold text-red-700" : ""}`}>{dinero(c.vencido)}</td>
                  <td className="whitespace-nowrap px-4 py-3">{c.atraso === null ? "—" : c.atraso > 0 ? `${c.atraso} ${c.atraso === 1 ? "día" : "días"}` : "Al corriente"}</td>
                  <td className="whitespace-nowrap px-4 py-3">
                    {c.proximoVencimiento ? (
                      formatFecha(c.proximoVencimiento)
                    ) : c.plazoTerminado ? (
                      <span title="Ya vencieron todas sus mensualidades; solo queda cobrar lo vencido">Plazo terminado</span>
                    ) : (
                      "—"
                    )}
                    {c.montoSiguiente !== null && <span className="block text-xs text-finbra-gray">{formatMoney(c.montoSiguiente)}</span>}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3">
                    {c.cubiertos === null ? "—" : `${c.cubiertos} pagadas${c.vencimientos ? ` de ${c.vencimientos}` : ""}`}
                    {c.cubiertos !== null && !!c.vencimientos && (
                      <div className="mt-1 w-28">
                        <ProgressBar percent={(c.cubiertos / c.vencimientos) * 100} label={`${c.cubiertos} de ${c.vencimientos} mensualidades pagadas`} />
                      </div>
                    )}
                    {!!c.vencidos && <span className="block text-xs text-red-700">{c.vencidos === 1 ? "1 vencida" : `${c.vencidos} vencidas`}</span>}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3">
                    <FinDelPlazo c={c} />
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
