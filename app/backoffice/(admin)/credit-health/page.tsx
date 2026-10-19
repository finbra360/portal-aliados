import Link from "next/link";
import Card from "@/components/ui/Card";
import EmptyState from "@/components/ui/EmptyState";
import StatCard from "@/components/ui/StatCard";
import { getAdminSession } from "@/lib/get-admin-session";
import { hasRole } from "@/lib/rbac";
import { CH_VEN } from "@/lib/credit-health/roles";
import { CLASIFICACIONES, CLASIFICACION_LABELS, SECTORES } from "@/lib/credit-health/catalogo";
import { resumenCreditHealth } from "@/lib/credit-health/prospectos";
import { ClasificacionPill, ErrorCarga, fecha, pesos } from "./ui";

const RANGOS = [7, 30, 90, 365] as const;

export default async function CreditHealthResumenPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  if (!hasRole(await getAdminSession(), CH_VEN)) return null;
  const sp = await searchParams;
  const dias = RANGOS.includes(Number(sp.dias) as (typeof RANGOS)[number]) ? Number(sp.dias) : 30;
  const incluirDemo = sp.demo === "1";

  let datos: Awaited<ReturnType<typeof resumenCreditHealth>> | null = null;
  try {
    datos = await resumenCreditHealth(dias, incluirDemo);
  } catch (e) {
    console.error("[credit-health] resumen", e instanceof Error ? e.message : e);
  }

  const qs = (cambios: Record<string, string | undefined>) => {
    const q = new URLSearchParams();
    const v = { dias: String(dias), demo: incluirDemo ? "1" : undefined, ...cambios };
    for (const [k, val] of Object.entries(v)) if (val) q.set(k, val);
    return `?${q.toString()}`;
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Credit Health</h1>
          <p className="mt-1 text-sm text-finbra-gray">Prospectos que llegan del diagnóstico financiero público.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <div className="flex rounded-xl bg-white p-1 ring-1 ring-black/5">
            {RANGOS.map((r) => (
              <Link
                key={r}
                href={qs({ dias: String(r) })}
                aria-current={r === dias ? "true" : undefined}
                className={`rounded-lg px-3 py-1.5 font-semibold ${r === dias ? "bg-finbra-purple text-white" : "text-finbra-gray hover:text-black"}`}
              >
                {r === 365 ? "12 meses" : `${r} días`}
              </Link>
            ))}
          </div>
          <Link href={qs({ demo: incluirDemo ? undefined : "1" })} className="rounded-lg px-3 py-1.5 font-semibold text-finbra-purple hover:underline">
            {incluirDemo ? "Ocultar demo" : "Incluir demo"}
          </Link>
        </div>
      </div>

      {!datos ? (
        <ErrorCarga texto="No pudimos cargar el resumen de Credit Health." />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard label="Diagnósticos completados" value={datos.embudo.completados.toLocaleString("es-MX")} sublabel={`${datos.embudo.iniciados.toLocaleString("es-MX")} iniciados`} />
            <StatCard
              label="Prospectos recibidos"
              value={datos.embudo.prospectos.toLocaleString("es-MX")}
              sublabel={datos.embudo.completados ? `${Math.round((datos.embudo.prospectos / datos.embudo.completados) * 100)} % de los diagnósticos` : undefined}
            />
            <StatCard
              label="Alta prioridad"
              value={(datos.porClase.find((c) => c.clasificacion === "alta_prioridad")?.n ?? 0).toLocaleString("es-MX")}
              sublabel={pesos(datos.porClase.find((c) => c.clasificacion === "alta_prioridad")?.monto ?? 0) + " preliminar"}
            />
            <StatCard
              label="Monto preliminar potencial"
              value={pesos(datos.porClase.filter((c) => c.clasificacion !== "no_elegible").reduce((a, c) => a + c.monto, 0))}
              sublabel="Sin contar no elegibles"
            />
          </div>

          <div className="grid gap-6 xl:grid-cols-2">
            <Card>
              <h2 className="font-semibold">Embudo</h2>
              <p className="mb-4 text-xs text-finbra-gray">Visitantes únicos por etapa (anónimo) y prospectos por estado de contacto.</p>
              <Barras
                filas={[
                  ["Iniciaron diagnóstico", datos.embudo.iniciados],
                  ["Completaron diagnóstico", datos.embudo.completados],
                  ["Descargaron PDF", datos.embudo.pdf],
                  ["Dejaron sus datos", datos.embudo.prospectos],
                  ["Contactados", datos.embudo.contactados],
                  ["Convertidos", datos.embudo.convertidos],
                ]}
              />
            </Card>
            <Card>
              <h2 className="mb-4 font-semibold">Clasificación</h2>
              <Barras
                filas={CLASIFICACIONES.map((c) => [CLASIFICACION_LABELS[c], datos.porClase.find((x) => x.clasificacion === c)?.n ?? 0, `/backoffice/credit-health/prospectos?clasificacion=${c}`])}
              />
              {datos.porSector.length ? (
                <>
                  <h3 className="mb-2 mt-6 text-sm font-semibold">Por sector</h3>
                  <ul className="flex flex-wrap gap-2">
                    {datos.porSector.map((s) => (
                      <li key={s.sector ?? "na"} className="rounded-full bg-black/5 px-3 py-1 text-xs">
                        {(s.sector && SECTORES[s.sector]) || "Sin sector"} <strong>{s.n}</strong>
                      </li>
                    ))}
                  </ul>
                </>
              ) : null}
            </Card>
          </div>

          <Card className="p-0">
            <div className="flex items-center justify-between px-6 pt-5">
              <h2 className="font-semibold">Alta prioridad sin contactar</h2>
              <Link href="/backoffice/credit-health/prospectos?clasificacion=alta_prioridad&contacto=nuevo" className="text-sm font-semibold text-finbra-purple hover:underline">
                Ver todos
              </Link>
            </div>
            {datos.prioridad.length ? (
              <ul className="mt-2 divide-y divide-black/5">
                {datos.prioridad.map((p) => (
                  <li key={p.id}>
                    <Link href={`/backoffice/credit-health/prospectos/${p.id}`} className="flex items-center justify-between gap-4 px-6 py-3 hover:bg-finbra-purple/5">
                      <div className="min-w-0">
                        <p className="truncate font-medium">{p.tradeName}</p>
                        <p className="text-xs text-finbra-gray">
                          {p.folio} · {fecha(p.createdAt)} · {(p.sectorCode && SECTORES[p.sectorCode]) || "—"}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-3">
                        <span className="font-semibold tabular-nums">{pesos(p.preliminaryAmount)}</span>
                        <ClasificacionPill valor={p.classification} />
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="p-6">
                <EmptyState title="Nada pendiente" description="No hay prospectos de alta prioridad sin contactar." />
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  );
}

function Barras({ filas }: { filas: Array<[string, number, string?]> }) {
  const max = Math.max(1, ...filas.map(([, v]) => v));
  return (
    <ul className="space-y-3">
      {filas.map(([etiqueta, valor, href]) => {
        const contenido = (
          <>
            <div className="flex items-baseline justify-between text-sm">
              <span className={href ? "font-medium group-hover:text-finbra-purple" : "font-medium"}>{etiqueta}</span>
              <span className="font-semibold tabular-nums">{valor.toLocaleString("es-MX")}</span>
            </div>
            <div className="mt-1 h-2 overflow-hidden rounded-full bg-finbra-purple/10" aria-hidden="true">
              <div className="h-full rounded-full bg-finbra-purple" style={{ width: `${(valor / max) * 100}%` }} />
            </div>
          </>
        );
        return (
          <li key={etiqueta}>
            {href ? (
              <Link href={href} className="group block">
                {contenido}
              </Link>
            ) : (
              contenido
            )}
          </li>
        );
      })}
    </ul>
  );
}
