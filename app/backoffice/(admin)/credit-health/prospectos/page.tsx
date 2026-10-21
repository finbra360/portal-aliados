import Link from "next/link";
import Card from "@/components/ui/Card";
import EmptyState from "@/components/ui/EmptyState";
import { getAdminSession } from "@/lib/get-admin-session";
import { hasRole } from "@/lib/rbac";
import { CH_EXPORTAN, CH_VEN, CH_VEN_CONTACTO } from "@/lib/credit-health/roles";
import { CLASIFICACIONES, CLASIFICACION_LABELS, ESTADOS_CONTACTO, ESTADO_CONTACTO_LABELS, SECTORES } from "@/lib/credit-health/catalogo";
import { filtrosQuery, PAGINA_CH, parseFiltros } from "@/lib/credit-health/filtros";
import { listarProspectos } from "@/lib/credit-health/prospectos";
import { ClasificacionPill, ContactoPill, DemoPill, ErrorCarga, fecha, pesos, veces } from "../ui";

const campo = "h-10 rounded-lg border border-black/10 bg-white px-3 text-sm focus:border-finbra-purple focus:outline-none";

export default async function ProspectosPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const session = await getAdminSession();
  if (!hasRole(session, CH_VEN)) return null;
  const sp = await searchParams;
  const f = parseFiltros(sp);

  let datos: Awaited<ReturnType<typeof listarProspectos>> | null = null;
  try {
    datos = await listarProspectos(f);
  } catch (e) {
    console.error("[credit-health] listado", e instanceof Error ? e.message : e);
  }
  const paginas = datos ? Math.max(1, Math.ceil(datos.total / PAGINA_CH)) : 1;
  const exportar = `/api/credit-health/export${filtrosQuery(sp, { pagina: undefined })}`;

  return (
    <div className="space-y-6">
      {sp.aviso === "eliminado" ? <p className="rounded-xl bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-700">El prospecto se eliminó definitivamente.</p> : null}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Prospectos de Credit Health</h1>
          <p className="mt-1 text-sm text-finbra-gray">{datos ? `${datos.total.toLocaleString("es-MX")} con los filtros actuales.` : " "}</p>
        </div>
        {hasRole(session, CH_EXPORTAN) ? (
          <div className="flex flex-wrap gap-2 text-sm">
            <a href={exportar} className="rounded-lg border border-black/10 bg-white px-4 py-2 font-semibold hover:border-finbra-purple/40">
              Exportar CSV
            </a>
            {hasRole(session, CH_VEN_CONTACTO) ? (
              <a href={`${exportar}${exportar.includes("?") ? "&" : "?"}contacto=1`} className="rounded-lg px-4 py-2 font-semibold text-finbra-purple hover:underline">
                CSV con contacto
              </a>
            ) : null}
          </div>
        ) : null}
      </div>

      <Card className="p-4">
        <form method="get" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <input name="q" defaultValue={sp.q} placeholder="Empresa o folio" aria-label="Buscar empresa o folio" className={`${campo} sm:col-span-2`} />
          <select name="clasificacion" defaultValue={sp.clasificacion ?? ""} aria-label="Clasificación" className={campo}>
            <option value="">Toda clasificación</option>
            {CLASIFICACIONES.map((c) => (
              <option key={c} value={c}>
                {CLASIFICACION_LABELS[c]}
              </option>
            ))}
          </select>
          <select name="contacto" defaultValue={sp.contacto ?? ""} aria-label="Estado de contacto" className={campo}>
            <option value="">Todo estado</option>
            {ESTADOS_CONTACTO.map((c) => (
              <option key={c} value={c}>
                {ESTADO_CONTACTO_LABELS[c]}
              </option>
            ))}
          </select>
          <select name="sector" defaultValue={sp.sector ?? ""} aria-label="Industria" className={campo}>
            <option value="">Toda industria</option>
            {Object.entries(SECTORES).map(([code, nombre]) => (
              <option key={code} value={code}>
                {nombre}
              </option>
            ))}
          </select>
          <input name="montoMin" defaultValue={sp.montoMin} placeholder="Monto solicitado mín." inputMode="numeric" aria-label="Monto solicitado mínimo" className={campo} />
          <input name="montoMax" defaultValue={sp.montoMax} placeholder="Monto solicitado máx." inputMode="numeric" aria-label="Monto solicitado máximo" className={campo} />
          <input name="pagoMin" defaultValue={sp.pagoMin} placeholder="Pago sostenible mín." inputMode="numeric" aria-label="Capacidad de pago mínima" className={campo} />
          <select name="orden" defaultValue={sp.orden ?? "recientes"} aria-label="Ordenar" className={campo}>
            <option value="recientes">Más recientes</option>
            <option value="monto">Mayor monto</option>
            <option value="capacidad">Mayor capacidad de pago</option>
            <option value="score">Mayor score</option>
          </select>
          <label className="flex items-center gap-2 text-sm text-finbra-gray">
            <input type="checkbox" name="demo" value="1" defaultChecked={f.incluirDemo} className="size-4 accent-[#5d5bdb]" />
            Incluir demo
          </label>
          <div className="flex gap-2 lg:col-span-2 lg:justify-end">
            <button type="submit" className="h-10 rounded-lg bg-finbra-purple px-5 text-sm font-semibold text-white hover:bg-finbra-purple-700">
              Filtrar
            </button>
            <Link href="/backoffice/credit-health/prospectos" className="flex h-10 items-center rounded-lg px-4 text-sm font-semibold text-finbra-gray hover:text-black">
              Limpiar
            </Link>
          </div>
        </form>
      </Card>

      {!datos ? (
        <ErrorCarga texto="No pudimos cargar los prospectos de Credit Health." />
      ) : datos.filas.length === 0 ? (
        <EmptyState title="No hay prospectos con estos filtros" description="Prueba quitando algún filtro o incluye los de demostración." />
      ) : (
        <Card className="overflow-x-auto p-0" tabIndex={0} aria-label="Prospectos de Credit Health (desplazable)">
          <table className="w-full min-w-[980px] text-left text-sm">
            <thead>
              <tr className="border-b border-black/5 text-xs uppercase tracking-wide text-finbra-gray">
                <th scope="col" className="px-6 py-3">Empresa</th>
                <th scope="col" className="px-4 py-3">Clasificación</th>
                <th scope="col" className="px-4 py-3 text-right">Solicitado</th>
                <th scope="col" className="px-4 py-3 text-right">Preliminar</th>
                <th scope="col" className="px-4 py-3 text-right">Pago sostenible</th>
                <th scope="col" className="px-4 py-3 text-right">DSCR</th>
                <th scope="col" className="px-4 py-3 text-right">Score</th>
                <th scope="col" className="px-4 py-3">Contacto</th>
                <th scope="col" className="px-6 py-3">Fecha</th>
              </tr>
            </thead>
            <tbody>
              {datos.filas.map((p) => (
                <tr key={p.id} className="border-b border-black/5 last:border-0 hover:bg-finbra-purple/5">
                  <td className="px-6 py-3">
                    <Link href={`/backoffice/credit-health/prospectos/${p.id}`} className="font-medium hover:text-finbra-purple">
                      {p.tradeName ?? <span className="italic text-finbra-gray">Sin empresa todavía</span>}
                    </Link>
                    <div className="mt-0.5 flex items-center gap-2 text-xs text-finbra-gray">
                      <span>
                        {p.folio} · {(p.sectorCode && SECTORES[p.sectorCode]) || "—"}
                      </span>
                      {p.isDemo ? <DemoPill /> : null}
                    </div>
                    {p.exclusionReasons.length ? (
                      <p className="mt-0.5 max-w-xs truncate text-xs text-red-700" title={p.exclusionReasons.join(" · ")}>
                        {p.exclusionReasons[0]}
                      </p>
                    ) : null}
                  </td>
                  <td className="px-4 py-3">
                    <ClasificacionPill valor={p.classification} />
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">{pesos(p.requestedAmount)}</td>
                  <td className="px-4 py-3 text-right font-semibold tabular-nums">{pesos(p.preliminaryAmount)}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{pesos(p.maxPayment)}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{veces(p.dscrProjected)}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{p.score ?? "—"}</td>
                  <td className="px-4 py-3">
                    <ContactoPill valor={p.contactStatus} />
                  </td>
                  <td className="whitespace-nowrap px-6 py-3 text-xs text-finbra-gray">{fecha(p.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {paginas > 1 ? (
            <div className="flex items-center justify-between border-t border-black/5 px-6 py-3 text-sm">
              <span className="text-finbra-gray">
                Página {f.pagina} de {paginas}
              </span>
              <div className="flex gap-2">
                {f.pagina > 1 ? (
                  <Link className="rounded-lg border border-black/10 px-3 py-1.5 font-semibold" href={`/backoffice/credit-health/prospectos${filtrosQuery(sp, { pagina: String(f.pagina - 1) })}`}>
                    Anterior
                  </Link>
                ) : null}
                {f.pagina < paginas ? (
                  <Link className="rounded-lg border border-black/10 px-3 py-1.5 font-semibold" href={`/backoffice/credit-health/prospectos${filtrosQuery(sp, { pagina: String(f.pagina + 1) })}`}>
                    Siguiente
                  </Link>
                ) : null}
              </div>
            </div>
          ) : null}
        </Card>
      )}
    </div>
  );
}
