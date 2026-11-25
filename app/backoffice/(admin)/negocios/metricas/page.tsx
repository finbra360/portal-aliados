import Link from "next/link";
import { getAdminSession } from "@/lib/get-admin-session";
import { puede } from "@/lib/permisos";
import { codigoDeError } from "@/lib/collections/errors";
import { formatMoney } from "@/lib/format";
import { hayNegocios } from "@/lib/db/negocios";
import { getEmbudo } from "@/lib/db/embudo";
import { ETIQUETA_ETAPA, ORIGENES_NEGOCIO, type OrigenNegocio } from "@/lib/clientes/negocios";
import { PERIODOS, leerPeriodo, type Grupo } from "@/lib/clientes/embudo";
import Card from "@/components/ui/Card";
import EmptyState from "@/components/ui/EmptyState";

const BASE = "/backoffice/negocios";
const pestana = (activa: boolean) =>
  `rounded-full px-3 py-1 text-sm font-medium ${activa ? "bg-finbra-purple text-white" : "bg-black/5 text-finbra-gray hover:bg-black/10"}`;
const pct = (n: number, de: number) => (de === 0 ? "—" : `${Math.round((n / de) * 100)} %`);
const dias = (x: number | null) => (x === null ? "—" : `${Number.isInteger(x) ? x : x.toFixed(1)} ${x === 1 ? "día" : "días"}`);

function TablaGrupos({ titulo, grupos, nombre }: { titulo: string; grupos: Grupo[]; nombre: (clave: string) => string }) {
  return (
    <Card className="space-y-3 overflow-x-auto">
      <h2 className="text-lg font-bold">{titulo}</h2>
      {grupos.length === 0 ? (
        <p className="text-sm text-finbra-gray">Sin negocios en el periodo.</p>
      ) : (
        <table className="w-full min-w-[560px] text-left text-sm">
          <thead>
            <tr className="border-b border-black/5 text-xs uppercase tracking-wide text-finbra-gray">
              <th scope="col" className="py-2 pr-3">{titulo.replace("Por ", "")}</th>
              <th scope="col" className="py-2 pr-3 text-right">Entraron</th>
              <th scope="col" className="py-2 pr-3 text-right">Dispersados</th>
              <th scope="col" className="py-2 pr-3 text-right">Monto dispersado</th>
              <th scope="col" className="py-2 text-right">Abiertos hoy</th>
            </tr>
          </thead>
          <tbody>
            {grupos.map((g) => (
              <tr key={g.clave} className="border-b border-black/5 last:border-0">
                <td className="py-2 pr-3">{nombre(g.clave)}</td>
                <td className="py-2 pr-3 text-right tabular-nums">{g.entraron}</td>
                <td className="py-2 pr-3 text-right tabular-nums">{g.dispersados}</td>
                <td className="py-2 pr-3 text-right tabular-nums">{g.montoDispersado ? formatMoney(g.montoDispersado) : "—"}</td>
                <td className="py-2 text-right tabular-nums">
                  {g.abiertos}
                  {g.montoAbierto ? <span className="text-finbra-gray"> · {formatMoney(g.montoAbierto)}</span> : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}

export default async function MetricasNegociosPage({ searchParams }: { searchParams: Promise<{ periodo?: string }> }) {
  const session = await getAdminSession();
  if (!puede(session, "originacion.ver")) {
    return <EmptyState title="No tienes acceso a Negocios" description="Tu rol no puede ver la originación." />;
  }
  const periodo = leerPeriodo((await searchParams).periodo);

  let e: Awaited<ReturnType<typeof getEmbudo>>;
  try {
    if (!(await hayNegocios())) {
      return <EmptyState title="Falta preparar la base de datos" description="Corre lib/db/crm-schema.sql y después security.sql en Supabase para activar los negocios de crédito." />;
    }
    e = await getEmbudo(periodo);
  } catch (err) {
    const c = codigoDeError("originación: métricas", err);
    return <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-red-700">No pudimos calcular las métricas. <span className="text-sm opacity-70">(código {c})</span></div>;
  }

  const enComite = e.abiertos.find((a) => a.etapa === "comite")!;
  const abierto = e.abiertos.reduce((s, a) => ({ n: s.n + a.n, monto: s.monto + a.monto }), { n: 0, monto: 0 });
  const maxAbierto = Math.max(1, ...e.abiertos.map((a) => a.monto));
  const primero = e.llegaron[0]?.n ?? 0;

  return (
    <div className="space-y-6">
      <div>
        <Link href={BASE} className="text-sm text-finbra-purple hover:underline">← Negocios</Link>
        <div className="mt-2 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold">Métricas de originación</h1>
            <p className="mt-1 text-sm text-finbra-gray">
              Los últimos {periodo} días. El monto de cada negocio es el de su crédito en SIAC si ya está ligado; si no, el aprobado en comité, el ofrecido o el estimado.
            </p>
          </div>
          <div className="flex gap-2" aria-label="Periodo">
            {PERIODOS.map((p) => (
              <Link key={p} href={`${BASE}/metricas?periodo=${p}`} aria-current={p === periodo ? "page" : undefined} className={pestana(p === periodo)}>
                {p === 365 ? "1 año" : `${p} días`}
              </Link>
            ))}
          </div>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="space-y-1">
          <p className="text-sm text-finbra-gray">Entraron</p>
          <p className="text-2xl font-bold tabular-nums">{e.entraron}</p>
          <p className="text-xs text-finbra-gray">{e.rechazados} {e.rechazados === 1 ? "rechazado" : "rechazados"} en el periodo</p>
        </Card>
        <Card className="space-y-1">
          <p className="text-sm text-finbra-gray">Dispersados</p>
          <p className="text-2xl font-bold tabular-nums text-finbra-purple">{formatMoney(e.dispersados.monto)}</p>
          <p className="text-xs text-finbra-gray">{e.dispersados.n} {e.dispersados.n === 1 ? "negocio" : "negocios"}</p>
        </Card>
        <Card className="space-y-1">
          <p className="text-sm text-finbra-gray">En comité hoy</p>
          <p className="text-2xl font-bold tabular-nums">{formatMoney(enComite.monto)}</p>
          <p className="text-xs text-finbra-gray">{enComite.n} {enComite.n === 1 ? "negocio" : "negocios"}</p>
        </Card>
        <Card className="space-y-1">
          <p className="text-sm text-finbra-gray">En proceso hoy</p>
          <p className="text-2xl font-bold tabular-nums">{formatMoney(abierto.monto)}</p>
          <p className="text-xs text-finbra-gray">{abierto.n} {abierto.n === 1 ? "negocio abierto" : "negocios abiertos"}</p>
        </Card>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card className="space-y-3">
          <div>
            <h2 className="text-lg font-bold">Hasta dónde llegan</h2>
            <p className="text-sm text-finbra-gray">De los {e.entraron} que entraron en el periodo, cuántos llegaron a cada etapa (aunque después se rechazaran).</p>
          </div>
          <ol className="space-y-2">
            {e.llegaron.map((x) => (
              <li key={x.etapa} className="grid grid-cols-[7rem_1fr_4.5rem] items-center gap-3 text-sm">
                <span>{ETIQUETA_ETAPA[x.etapa]}</span>
                <span className="h-3 rounded-full bg-black/5" aria-hidden="true">
                  <span className="block h-3 rounded-full bg-finbra-purple" style={{ width: primero ? `${(x.n / primero) * 100}%` : "0%" }} />
                </span>
                <span className="text-right tabular-nums">
                  {x.n} <span className="text-xs text-finbra-gray">{pct(x.n, primero)}</span>
                </span>
              </li>
            ))}
          </ol>
        </Card>

        <Card className="space-y-3 overflow-x-auto">
          <div>
            <h2 className="text-lg font-bold">Cuánto tardan</h2>
            <p className="text-sm text-finbra-gray">Días típicos (la mediana) en cada etapa, de los negocios que salieron de ella en el periodo.</p>
          </div>
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-black/5 text-xs uppercase tracking-wide text-finbra-gray">
                <th scope="col" className="py-2 pr-3">Etapa</th>
                <th scope="col" className="py-2 pr-3 text-right">Días típicos</th>
                <th scope="col" className="py-2 pr-3 text-right">Salieron</th>
                <th scope="col" className="py-2 text-right">Ahí hoy</th>
              </tr>
            </thead>
            <tbody>
              {e.tiempos.map((t) => {
                const hoy = e.abiertos.find((a) => a.etapa === t.etapa)!;
                return (
                  <tr key={t.etapa} className="border-b border-black/5 last:border-0">
                    <td className="py-2 pr-3">{ETIQUETA_ETAPA[t.etapa]}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{dias(t.mediana)}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{t.n}</td>
                    <td className="py-2 text-right tabular-nums">
                      {hoy.n}
                      {hoy.monto ? (
                        <span className="ml-2 inline-block h-2 rounded-full bg-finbra-purple/40 align-middle" style={{ width: `${Math.max(4, (hoy.monto / maxAbierto) * 64)}px` }} title={formatMoney(hoy.monto)} />
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      </div>

      <Card className="space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-lg font-bold">Atorados</h2>
          <span className="text-xs text-finbra-gray">
            {e.diasAtorado > 0 ? `Más de ${e.diasAtorado} ${e.diasAtorado === 1 ? "día" : "días"} en la misma etapa (se cambia en Clientes → Ajustes, «Negocio sin movimiento»).` : "Apagado en Clientes → Ajustes («Negocio sin movimiento»)."}
          </span>
        </div>
        {e.atorados.length === 0 ? (
          <p className="text-sm text-finbra-gray">Ningún negocio atorado.</p>
        ) : (
          <ul className="divide-y divide-black/5">
            {e.atorados.slice(0, 15).map((n) => (
              <li key={n.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                <Link href={`${BASE}/${n.id}`} className="font-medium hover:text-finbra-purple hover:underline">{n.empresa}</Link>
                <span className="text-finbra-gray">
                  {ETIQUETA_ETAPA[n.etapa]} · <span className="font-semibold text-amber-800">{n.dias} días</span> · {n.responsable ?? "Sin responsable"}
                  {n.monto !== null && ` · ${formatMoney(n.monto)}`}
                </span>
              </li>
            ))}
          </ul>
        )}
        {e.atorados.length > 15 && <p className="text-xs text-finbra-gray">Y {e.atorados.length - 15} más.</p>}
      </Card>

      <div className="grid gap-6 xl:grid-cols-2">
        <TablaGrupos titulo="Por origen" grupos={e.porOrigen} nombre={(k) => ORIGENES_NEGOCIO[k as OrigenNegocio] ?? k} />
        <TablaGrupos titulo="Por responsable" grupos={e.porResponsable} nombre={(k) => k} />
      </div>
      {e.porBroker.length > 0 && <TablaGrupos titulo="Por broker" grupos={e.porBroker} nombre={(k) => k} />}
      <p className="text-xs text-finbra-gray">
        «Entraron»: negocios dados de alta en el periodo. «Dispersados»: los que pasaron a Dispersado en el periodo, sin importar cuándo entraron. «Abiertos hoy»: de Prospecto a Formalización.
      </p>
    </div>
  );
}
