import Link from "next/link";
import { getAdminSession } from "@/lib/get-admin-session";
import { puede } from "@/lib/permisos";
import { codigoDeError } from "@/lib/collections/errors";
import { formatFecha, formatMoney } from "@/lib/format";
import { hayNegocios } from "@/lib/db/negocios";
import { getEmbudo, type MetricasNegocios } from "@/lib/db/embudo";
import { ETIQUETA_ETAPA, ORIGENES_NEGOCIO, type OrigenNegocio } from "@/lib/clientes/negocios";
import { MIN_BASE, PERIODOS, leerPeriodo, type Grupo, type Periodo, type Trimestre } from "@/lib/clientes/embudo";
import Card from "@/components/ui/Card";
import EmptyState from "@/components/ui/EmptyState";

// Métricas de originación. Una sola tinta (el morado de Finbra) para las
// barras: todas son de una sola serie y llevan su valor escrito, así que no
// dependen del color ni necesitan leyenda. Ámbar solo para lo atorado.

const BASE = "/backoffice/negocios";
const ETIQUETA_PERIODO: Record<Periodo, string> = { 30: "30 días", 90: "90 días", 365: "1 año", 0: "Todo" };

const pestana = (activa: boolean) =>
  `rounded-full px-3 py-1 text-sm font-medium ${activa ? "bg-finbra-purple text-white" : "bg-black/5 text-finbra-gray hover:bg-black/10"}`;

/** $2.9 M · $850 k */
function corto(n: number | null): string {
  if (n === null) return "—";
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toLocaleString("es-MX", { maximumFractionDigits: 1 })} M`;
  if (Math.abs(n) >= 1_000) return `$${Math.round(n / 1_000).toLocaleString("es-MX")} k`;
  return formatMoney(n);
}
const pct = (x: number | null, dec = 0) => (x === null ? "—" : `${(x * 100).toLocaleString("es-MX", { maximumFractionDigits: dec })} %`);
const dias = (x: number | null) => (x === null ? "—" : `${Math.round(x)} ${Math.round(x) === 1 ? "día" : "días"}`);

const plural = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`;

/**
 * Cambio contra el periodo anterior, con flecha y palabra (nunca solo color).
 * Verde es lo bueno: subir, o bajar cuando `mejorSiBaja` (por ejemplo, rechazos).
 */
function Cambio({ ahora, antes, puntos = false, mejorSiBaja = false }: { ahora: number | null; antes: number | null | undefined; puntos?: boolean; mejorSiBaja?: boolean }) {
  const tono = (sube: boolean) => ((sube !== mejorSiBaja) ? "text-emerald-700" : "text-red-700");
  if (ahora === null || antes === null || antes === undefined) return null;
  if (puntos) {
    const d = Math.round((ahora - antes) * 100);
    if (d === 0) return <span className="text-xs text-finbra-gray">igual que antes</span>;
    return (
      <span className={`text-xs font-medium ${tono(d > 0)}`}>
        {d > 0 ? "▲" : "▼"} {Math.abs(d)} pts vs. periodo anterior
      </span>
    );
  }
  if (antes === 0) return ahora > 0 ? <span className="text-xs text-finbra-gray">antes: 0</span> : null;
  const v = ahora / antes - 1;
  if (Math.abs(v) < 0.005) return <span className="text-xs text-finbra-gray">igual que antes</span>;
  return (
    <span className={`text-xs font-medium ${tono(v > 0)}`}>
      {v > 0 ? "▲" : "▼"} {pct(Math.abs(v))} vs. periodo anterior
    </span>
  );
}

function Indicador({ titulo, valor, detalle, cambio, destacado = false }: { titulo: string; valor: string; detalle?: React.ReactNode; cambio?: React.ReactNode; destacado?: boolean }) {
  return (
    <Card className={`flex flex-col gap-1 ${destacado ? "ring-1 ring-finbra-purple/30" : ""}`}>
      <p className="text-xs font-medium uppercase tracking-wide text-finbra-gray">{titulo}</p>
      <p className={`font-bold tabular-nums ${destacado ? "text-3xl text-finbra-purple" : "text-2xl"}`}>{valor}</p>
      {detalle && <p className="text-xs text-finbra-gray">{detalle}</p>}
      {cambio}
    </Card>
  );
}

function Seccion({ titulo, descripcion, accion, children }: { titulo: string; descripcion?: string; accion?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="text-lg font-bold">{titulo}</h2>
          {descripcion && <p className="max-w-3xl text-sm text-finbra-gray">{descripcion}</p>}
        </div>
        {accion}
      </div>
      {children}
    </section>
  );
}

/** Barra horizontal de una sola serie, con el valor a la derecha. */
function Barra({ valor, max, etiqueta, tenue = false }: { valor: number; max: number; etiqueta: string; tenue?: boolean }) {
  const w = max > 0 ? Math.max(valor > 0 ? 2 : 0, (valor / max) * 100) : 0;
  return (
    <div className="flex items-center gap-2">
      <span className="h-2.5 flex-1 overflow-hidden rounded-full bg-black/[0.05]" aria-hidden="true">
        <span className={`block h-full rounded-full ${tenue ? "bg-finbra-purple/40" : "bg-finbra-purple"}`} style={{ width: `${w}%` }} />
      </span>
      <span className="w-20 shrink-0 text-right text-xs tabular-nums">{etiqueta}</span>
    </div>
  );
}

/** Columnas del monto dispersado por trimestre, con detalle al pasar el mouse. */
function GraficaTrimestres({ trimestres }: { trimestres: Trimestre[] }) {
  const max = Math.max(1, ...trimestres.map((t) => t.montoDispersado));
  return (
    <div className="flex h-56 items-end gap-2 sm:gap-4" role="img" aria-label="Monto dispersado por trimestre (los valores están en la tabla de abajo)">
      {trimestres.map((t) => {
        const h = (t.montoDispersado / max) * 100;
        return (
          <div key={t.clave} className="group relative flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1">
            <span className="text-[11px] font-semibold tabular-nums text-black/80">{t.montoDispersado ? corto(t.montoDispersado) : ""}</span>
            <span
              className={`w-full max-w-14 rounded-t-md transition-colors ${t.enCurso ? "bg-finbra-purple/45 group-hover:bg-finbra-purple/60" : "bg-finbra-purple group-hover:bg-finbra-purple-700"}`}
              style={{ height: `${Math.max(t.montoDispersado ? 2 : 0, h)}%` }}
            />
            <span className="text-[11px] text-finbra-gray">{t.etiqueta}</span>
            <span className="-mt-1 h-3 text-[10px] text-finbra-gray">{t.enCurso ? "en curso" : ""}</span>
            <div className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 hidden w-44 -translate-x-1/2 rounded-lg border border-black/10 bg-white p-2 text-xs shadow-lg group-hover:block">
              <p className="font-semibold">{t.etiqueta}{t.enCurso ? " (en curso)" : ""}</p>
              <p className="tabular-nums">{formatMoney(t.montoDispersado)} dispersado</p>
              <p className="tabular-nums text-finbra-gray">
                {t.dispersados} {t.dispersados === 1 ? "negocio" : "negocios"} · ticket {corto(t.ticket)}
              </p>
              <p className="tabular-nums text-finbra-gray">{plural(t.entraron, "entró", "entraron")} · {plural(t.rechazados, "rechazado", "rechazados")}</p>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function TablaTrimestres({ trimestres }: { trimestres: Trimestre[] }) {
  // Filas por trimestre y, al terminar cada año, su total.
  const filas: ({ tipo: "q"; t: Trimestre } | { tipo: "anio"; anio: number; ts: Trimestre[] })[] = [];
  for (const [i, t] of trimestres.entries()) {
    filas.push({ tipo: "q", t });
    const siguiente = trimestres[i + 1];
    if (!siguiente || siguiente.anio !== t.anio) filas.push({ tipo: "anio", anio: t.anio, ts: trimestres.filter((x) => x.anio === t.anio) });
  }
  const th = "px-3 py-2 text-right font-semibold";
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[880px] text-sm">
        <thead>
          <tr className="border-b border-black/10 text-xs uppercase tracking-wide text-finbra-gray">
            <th scope="col" className="px-3 py-2 text-left font-semibold">Trimestre</th>
            <th scope="col" className={th}>Entraron</th>
            <th scope="col" className={th}>Dispersados</th>
            <th scope="col" className={th}>Monto dispersado</th>
            <th scope="col" className={th}>vs. Q anterior</th>
            <th scope="col" className={th}>Ticket</th>
            <th scope="col" className={th}>Ciclo</th>
            <th scope="col" className={th} title="De los que entraron en el trimestre, cuántos ya se dispersaron">Conversión</th>
            <th scope="col" className={th}>Rechazados</th>
            <th scope="col" className={th}>Pospuestos</th>
          </tr>
        </thead>
        <tbody>
          {filas.map((f) => {
            if (f.tipo === "q") {
              const t = f.t;
              return (
                <tr key={t.clave} className="border-b border-black/5">
                  <td className="px-3 py-2 font-medium">
                    {t.etiqueta}
                    {t.enCurso && <span className="ml-2 rounded-full bg-finbra-purple/10 px-2 py-0.5 text-[11px] font-medium text-finbra-purple">en curso</span>}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{t.entraron}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{t.dispersados}</td>
                  <td className="px-3 py-2 text-right font-semibold tabular-nums">{t.montoDispersado ? formatMoney(t.montoDispersado) : "—"}</td>
                  <td className={`px-3 py-2 text-right tabular-nums ${t.variacion === null ? "text-finbra-gray" : t.variacion >= 0 ? "text-emerald-700" : "text-red-700"}`}>
                    {t.variacion === null ? "—" : `${t.variacion >= 0 ? "▲" : "▼"} ${pct(Math.abs(t.variacion))}`}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{corto(t.ticket)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{dias(t.ciclo)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{pct(t.conversion)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{t.rechazados}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{t.pospuestos}</td>
                </tr>
              );
            }
            const s = (k: "entraron" | "dispersados" | "montoDispersado" | "rechazados" | "pospuestos") => f.ts.reduce((a, t) => a + t[k], 0);
            const monto = s("montoDispersado");
            const n = s("dispersados");
            return (
              <tr key={`anio-${f.anio}`} className="border-b border-black/10 bg-black/[0.03] font-semibold">
                <td className="px-3 py-2">
                  Total {f.anio}
                  {f.ts.length < 4 && <span className="ml-1 text-xs font-normal text-finbra-gray">({f.ts.length} {f.ts.length === 1 ? "trimestre" : "trimestres"})</span>}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{s("entraron")}</td>
                <td className="px-3 py-2 text-right tabular-nums">{n}</td>
                <td className="px-3 py-2 text-right tabular-nums">{monto ? formatMoney(monto) : "—"}</td>
                <td className="px-3 py-2 text-right text-finbra-gray">—</td>
                <td className="px-3 py-2 text-right tabular-nums">{corto(n ? monto / n : null)}</td>
                <td className="px-3 py-2 text-right text-finbra-gray">—</td>
                <td className="px-3 py-2 text-right text-finbra-gray">—</td>
                <td className="px-3 py-2 text-right tabular-nums">{s("rechazados")}</td>
                <td className="px-3 py-2 text-right tabular-nums">{s("pospuestos")}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function TablaGrupos({ titulo, grupos, nombre }: { titulo: string; grupos: Grupo[]; nombre: (clave: string) => string }) {
  const max = Math.max(1, ...grupos.map((g) => g.montoDispersado));
  return (
    <Card className="space-y-3 overflow-x-auto">
      <h3 className="font-bold">{titulo}</h3>
      {grupos.length === 0 ? (
        <p className="text-sm text-finbra-gray">Sin negocios en el periodo.</p>
      ) : (
        <table className="w-full min-w-[620px] text-sm">
          <thead>
            <tr className="border-b border-black/5 text-xs uppercase tracking-wide text-finbra-gray">
              <th scope="col" className="py-2 pr-3 text-left font-semibold">{titulo.replace("Por ", "")}</th>
              <th scope="col" className="py-2 pr-3 text-right font-semibold">Entraron</th>
              <th scope="col" className="py-2 pr-3 text-right font-semibold" title="De los que entraron en el periodo, cuántos ya se dispersaron">Conversión</th>
              <th scope="col" className="w-48 py-2 pr-3 text-left font-semibold">Dispersado</th>
              <th scope="col" className="py-2 pr-3 text-right font-semibold">Ticket</th>
              <th scope="col" className="py-2 text-right font-semibold">Abiertos hoy</th>
            </tr>
          </thead>
          <tbody>
            {grupos.map((g) => (
              <tr key={g.clave} className="border-b border-black/5 last:border-0">
                <td className="py-2 pr-3">{nombre(g.clave)}</td>
                <td className="py-2 pr-3 text-right tabular-nums">{g.entraron}</td>
                <td className="py-2 pr-3 text-right tabular-nums">{g.entraron ? pct(g.conversion) : "—"}</td>
                <td className="py-2 pr-3">
                  <Barra valor={g.montoDispersado} max={max} etiqueta={g.dispersados ? `${corto(g.montoDispersado)} · ${g.dispersados}` : "—"} />
                </td>
                <td className="py-2 pr-3 text-right tabular-nums">{corto(g.ticket)}</td>
                <td className="py-2 text-right tabular-nums">
                  {g.abiertos}
                  {g.montoAbierto ? <span className="text-finbra-gray"> · {corto(g.montoAbierto)}</span> : null}
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

  let e: MetricasNegocios;
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
  const primero = e.llegaron[0]?.n ?? 0;
  // El paso del embudo donde más se pierde (de una etapa a la siguiente).
  const pasos = e.llegaron.slice(1).map((x, i) => ({ de: e.llegaron[i].etapa, a: x.etapa, p: e.llegaron[i].n ? x.n / e.llegaron[i].n : null }));
  const peorPaso = pasos.filter((x) => x.p !== null).sort((a, b) => (a.p ?? 1) - (b.p ?? 1))[0];
  const maxMediana = Math.max(1, ...e.tiempos.map((t) => t.mediana ?? 0));
  const masLenta = [...e.tiempos].filter((t) => t.mediana !== null).sort((a, b) => (b.mediana ?? 0) - (a.mediana ?? 0))[0];
  const rechazosTotal = e.rechazos.finbra + e.rechazos.cliente + e.rechazos.sinDato;
  const maxMotivo = Math.max(1, ...e.rechazos.motivos.map((m) => m.n));
  const trimestresConDatos = e.trimestres.some((t) => t.entraron || t.dispersados);
  const ultimoCompleto = [...e.trimestres].reverse().find((t) => !t.enCurso);

  return (
    <div className="space-y-8">
      <div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Link href={BASE} className="text-sm text-finbra-purple hover:underline">← Negocios</Link>
          <Link href={`${BASE}/metricas/resumen`} className="text-sm text-finbra-purple hover:underline">Resumen semanal en Slack →</Link>
        </div>
        <div className="mt-2 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold">Métricas de originación</h1>
            <p className="mt-1 max-w-3xl text-sm text-finbra-gray">
              {periodo === 0 ? "Toda la historia" : `Del ${formatFecha(e.desde.slice(0, 10))} a hoy`}
              {e.anterior && " · comparado con el periodo anterior de la misma duración"}. El monto de cada negocio es el de su crédito en SIAC si ya está
              ligado; si no, el aprobado en comité, el ofrecido o el estimado.
            </p>
          </div>
          <div className="flex gap-2" aria-label="Periodo">
            {PERIODOS.map((p) => (
              <Link key={p} href={`${BASE}/metricas?periodo=${p}`} aria-current={p === periodo ? "page" : undefined} className={pestana(p === periodo)}>
                {ETIQUETA_PERIODO[p]}
              </Link>
            ))}
          </div>
        </div>
      </div>

      {/* Indicadores del periodo */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Indicador
          titulo="Monto dispersado"
          valor={corto(e.dispersados.monto)}
          detalle={`${e.dispersados.n} ${e.dispersados.n === 1 ? "negocio" : "negocios"} · ${formatMoney(e.dispersados.monto)}`}
          cambio={<Cambio ahora={e.dispersados.monto} antes={e.anterior?.dispersados.monto} />}
          destacado
        />
        <Indicador
          titulo="Ticket promedio"
          valor={corto(e.dispersados.ticket)}
          detalle="Monto dispersado entre negocios dispersados"
          cambio={<Cambio ahora={e.dispersados.ticket} antes={e.anterior?.dispersados.ticket} />}
        />
        <Indicador
          titulo="Ciclo de venta"
          valor={dias(e.dispersados.ciclo)}
          detalle={e.dispersados.cicloP75 !== null ? `Del alta a la dispersión (mediana). 3 de cada 4 en ${dias(e.dispersados.cicloP75)} o menos.` : "Del alta a la dispersión (mediana)"}
        />
        <Indicador
          titulo="Pronóstico ponderado"
          valor={corto(e.pronostico.monto)}
          detalle={
            e.pronostico.cubierto
              ? `De ${corto(e.pronostico.cubierto)} en etapas con suficiente historia (de ${corto(abierto.monto)} en proceso), por la probabilidad de su etapa`
              : "Todavía no hay suficientes negocios cerrados para estimarlo"
          }
        />
        <Indicador
          titulo="Entraron"
          valor={String(e.entraron)}
          detalle="Negocios dados de alta en el periodo"
          cambio={<Cambio ahora={e.entraron} antes={e.anterior?.entraron} />}
        />
        <Indicador
          titulo="Conversión"
          valor={pct(e.conversion)}
          detalle="De los que entraron, los que ya se dispersaron"
          cambio={<Cambio ahora={e.conversion} antes={e.anterior?.conversion} puntos />}
        />
        <Indicador titulo="En proceso hoy" valor={corto(abierto.monto)} detalle={`${abierto.n} ${abierto.n === 1 ? "negocio abierto" : "negocios abiertos"} · ${corto(enComite.monto)} en comité`} />
        <Indicador
          titulo="Rechazados"
          valor={String(e.rechazados)}
          detalle={`${e.rechazos.finbra} por Finbra · ${e.rechazos.cliente} el cliente desistió${e.rechazos.sinDato ? ` · ${e.rechazos.sinDato} sin dato` : ""} · ${plural(e.pospuestos, "pospuesto", "pospuestos")}`}
          cambio={<Cambio ahora={e.rechazados} antes={e.anterior?.rechazados} mejorSiBaja />}
        />
      </div>

      {/* Por trimestre */}
      <Seccion
        titulo="Por trimestre"
        descripcion="Los últimos 8 trimestres de calendario, sin importar el periodo de arriba. Cada negocio cuenta en el trimestre en que se dispersó, rechazó o pospuso; la conversión es de los que entraron en ese trimestre y sigue subiendo mientras tengan negocios abiertos."
      >
        <Card className="space-y-6">
          {trimestresConDatos ? (
            <>
              {ultimoCompleto && (
                <p className="text-sm">
                  En <span className="font-semibold">{ultimoCompleto.etiqueta}</span> se dispersaron{" "}
                  <span className="font-semibold tabular-nums">{formatMoney(ultimoCompleto.montoDispersado)}</span> en {ultimoCompleto.dispersados}{" "}
                  {ultimoCompleto.dispersados === 1 ? "negocio" : "negocios"}
                  {ultimoCompleto.variacion !== null && (
                    <>
                      , <span className={ultimoCompleto.variacion >= 0 ? "font-semibold text-emerald-700" : "font-semibold text-red-700"}>
                        {ultimoCompleto.variacion >= 0 ? "▲" : "▼"} {pct(Math.abs(ultimoCompleto.variacion))}
                      </span>{" "}
                      contra el trimestre anterior
                    </>
                  )}
                  .
                </p>
              )}
              <GraficaTrimestres trimestres={e.trimestres} />
              <TablaTrimestres trimestres={e.trimestres} />
            </>
          ) : (
            <p className="text-sm text-finbra-gray">Todavía no hay negocios en los últimos 8 trimestres.</p>
          )}
        </Card>
      </Seccion>

      <div className="grid gap-6 2xl:grid-cols-2">
        {/* Embudo */}
        <Seccion titulo="Hasta dónde llegan" descripcion={`De los ${e.entraron} que entraron en el periodo, cuántos llegaron al menos a cada etapa.`}>
          <Card className="space-y-3">
            <ol className="space-y-2">
              {e.llegaron.map((x, i) => {
                const paso = i > 0 ? pasos[i - 1] : null;
                return (
                  <li key={x.etapa} className="grid grid-cols-[6.5rem_1fr_6.5rem] items-center gap-3 text-sm">
                    <span className={peorPaso && paso && peorPaso.a === x.etapa ? "font-semibold text-red-700" : ""}>{ETIQUETA_ETAPA[x.etapa]}</span>
                    <Barra valor={x.n} max={primero} etiqueta={`${x.n} · ${pct(primero ? x.n / primero : null)}`} />
                    <span className="text-right text-xs tabular-nums text-finbra-gray">{paso ? `${pct(paso.p)} del paso` : "inicio"}</span>
                  </li>
                );
              })}
            </ol>
            {peorPaso && peorPaso.p !== null && peorPaso.p < 1 && (
              <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">
                Donde más se pierden: de <span className="font-semibold">{ETIQUETA_ETAPA[peorPaso.de]}</span> a{" "}
                <span className="font-semibold">{ETIQUETA_ETAPA[peorPaso.a]}</span> solo sigue el {pct(peorPaso.p)}.
              </p>
            )}
          </Card>
        </Seccion>

        {/* Tiempos */}
        <Seccion titulo="Cuánto tardan" descripcion="Días en cada etapa de los negocios que salieron de ella en el periodo. No cuentan los saltos de la importación de HubSpot.">
          <Card className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-sm">
              <thead>
                <tr className="border-b border-black/5 text-xs uppercase tracking-wide text-finbra-gray">
                  <th scope="col" className="py-2 pr-3 text-left font-semibold">Etapa</th>
                  <th scope="col" className="w-44 py-2 pr-3 text-left font-semibold">Mediana</th>
                  <th scope="col" className="py-2 pr-3 text-right font-semibold">Promedio</th>
                  <th scope="col" className="py-2 pr-3 text-right font-semibold" title="3 de cada 4 salen en estos días o menos">75 %</th>
                  <th scope="col" className="py-2 pr-3 text-right font-semibold">Salieron</th>
                  <th scope="col" className="py-2 text-right font-semibold">Ahí hoy</th>
                </tr>
              </thead>
              <tbody>
                {e.tiempos.map((t) => (
                  <tr key={t.etapa} className="border-b border-black/5 last:border-0">
                    <td className={`py-2 pr-3 ${masLenta?.etapa === t.etapa ? "font-semibold" : ""}`}>{ETIQUETA_ETAPA[t.etapa]}</td>
                    <td className="py-2 pr-3">
                      {t.mediana === null ? <span className="text-finbra-gray">—</span> : <Barra valor={t.mediana} max={maxMediana} etiqueta={dias(t.mediana)} />}
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums">{dias(t.promedio)}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{dias(t.p75)}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{t.n}</td>
                    <td className="py-2 text-right tabular-nums">{e.abiertos.find((a) => a.etapa === t.etapa)!.n}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {masLenta && <p className="mt-3 text-sm text-finbra-gray">La etapa más lenta es <span className="font-semibold text-black">{ETIQUETA_ETAPA[masLenta.etapa]}</span> ({dias(masLenta.mediana)} de mediana).</p>}
          </Card>
        </Seccion>
      </div>

      {/* Probabilidad y pronóstico */}
      <Seccion
        titulo="Probabilidad de cierre y pronóstico"
        descripcion={`Con toda la historia: de los negocios ya cerrados (dispersados, rechazados o pospuestos) que pasaron por cada etapa, cuántos se dispersaron. Se calcula con ${MIN_BASE} cerrados o más; los cerrados traídos de HubSpot solo cuentan en Prospecto, porque no se sabe por qué etapas pasaron. El pronóstico multiplica lo que hay hoy en cada etapa por su probabilidad; es una guía, no una promesa.`}
      >
        <Card className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead>
              <tr className="border-b border-black/5 text-xs uppercase tracking-wide text-finbra-gray">
                <th scope="col" className="py-2 pr-3 text-left font-semibold">Etapa</th>
                <th scope="col" className="py-2 pr-3 text-right font-semibold">Cerrados que pasaron por ahí</th>
                <th scope="col" className="py-2 pr-3 text-right font-semibold">Se dispersaron</th>
                <th scope="col" className="w-52 py-2 pr-3 text-left font-semibold">Probabilidad</th>
                <th scope="col" className="py-2 pr-3 text-right font-semibold">En proceso hoy</th>
                <th scope="col" className="py-2 text-right font-semibold">Pronóstico</th>
              </tr>
            </thead>
            <tbody>
              {e.probabilidades.map((x) => {
                const hoyEn = e.abiertos.find((a) => a.etapa === x.etapa)!;
                return (
                  <tr key={x.etapa} className="border-b border-black/5 last:border-0">
                    <td className="py-2 pr-3">{ETIQUETA_ETAPA[x.etapa]}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{x.base}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{x.dispersados}</td>
                    <td className="py-2 pr-3">{x.p === null ? <span className="text-xs text-finbra-gray">pocos datos</span> : <Barra valor={x.p} max={1} etiqueta={pct(x.p)} />}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">
                      {hoyEn.n} · {corto(hoyEn.monto)}
                    </td>
                    <td className="py-2 text-right font-semibold tabular-nums">{x.p === null || !hoyEn.monto ? "—" : corto(hoyEn.monto * x.p)}</td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="border-t border-black/10 font-semibold">
                <td className="py-2 pr-3" colSpan={4}>Total</td>
                <td className="py-2 pr-3 text-right tabular-nums">
                  {abierto.n} · {corto(abierto.monto)}
                </td>
                <td className="py-2 text-right tabular-nums text-finbra-purple">{corto(e.pronostico.monto)}</td>
              </tr>
            </tfoot>
          </table>
        </Card>
      </Seccion>

      <div className="grid gap-6 xl:grid-cols-2">
        {/* Rechazos */}
        <Seccion titulo="Por qué se pierden" descripcion={`${plural(e.rechazados, "rechazado", "rechazados")} y ${plural(e.pospuestos, "pospuesto", "pospuestos")} en el periodo.`}>
          <Card className="space-y-4">
            {rechazosTotal === 0 ? (
              <p className="text-sm text-finbra-gray">Sin rechazos en el periodo.</p>
            ) : (
              <>
                <dl className="grid grid-cols-3 gap-3 text-center">
                  {(
                    [
                      ["Finbra no aprobó", e.rechazos.finbra],
                      ["El cliente desistió", e.rechazos.cliente],
                      ["Sin dato", e.rechazos.sinDato],
                    ] as const
                  ).map(([t, v]) => (
                    <div key={t} className="rounded-lg bg-black/[0.03] p-3">
                      <dt className="text-xs text-finbra-gray">{t}</dt>
                      <dd className="text-xl font-bold tabular-nums">{v}</dd>
                      <dd className="text-xs tabular-nums text-finbra-gray">{pct(v / rechazosTotal)}</dd>
                    </div>
                  ))}
                </dl>
                <ul className="space-y-2">
                  {e.rechazos.motivos.map((m) => (
                    <li key={m.clave || "sin"} className="grid grid-cols-[minmax(0,12rem)_1fr] items-center gap-3 text-sm">
                      <span className="truncate" title={m.label}>{m.label}</span>
                      <Barra valor={m.n} max={maxMotivo} etiqueta={`${m.n} · ${pct(m.n / rechazosTotal)}`} tenue={!m.clave} />
                    </li>
                  ))}
                </ul>
              </>
            )}
          </Card>
        </Seccion>

        {/* Atorados */}
        <Seccion
          titulo="Atorados"
          descripcion={e.diasAtorado > 0 ? `Abiertos con más de ${e.diasAtorado} ${e.diasAtorado === 1 ? "día" : "días"} en la misma etapa (se cambia en Clientes → Ajustes, «Negocio sin movimiento»).` : "Apagado en Clientes → Ajustes («Negocio sin movimiento»)."}
        >
          <Card>
            {e.atorados.length === 0 ? (
              <p className="text-sm text-finbra-gray">Ningún negocio atorado.</p>
            ) : (
              <>
                <ul className="divide-y divide-black/5">
                  {e.atorados.slice(0, 12).map((n) => (
                    <li key={n.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                      <Link href={`${BASE}/${n.id}`} className="min-w-0 flex-1 truncate font-medium hover:text-finbra-purple hover:underline">{n.empresa}</Link>
                      <span className="shrink-0 text-finbra-gray">
                        {ETIQUETA_ETAPA[n.etapa]} · <span className="font-semibold text-amber-800">{n.dias} días</span>
                        {n.monto !== null && ` · ${corto(n.monto)}`}
                      </span>
                    </li>
                  ))}
                </ul>
                {e.atorados.length > 12 && <p className="mt-2 text-xs text-finbra-gray">Y {e.atorados.length - 12} más.</p>}
              </>
            )}
          </Card>
        </Seccion>
      </div>

      {/* Por grupo */}
      <Seccion titulo="Quién y qué trae negocio" descripcion="«Entraron» y «Conversión» son de los dados de alta en el periodo; «Dispersado», de los dispersados en el periodo, sin importar cuándo entraron.">
        <div className="grid gap-6 2xl:grid-cols-2">
          <TablaGrupos titulo="Por origen" grupos={e.porOrigen} nombre={(k) => ORIGENES_NEGOCIO[k as OrigenNegocio] ?? k} />
          <TablaGrupos titulo="Por producto" grupos={e.porProducto} nombre={(k) => k} />
          <TablaGrupos titulo="Por responsable" grupos={e.porResponsable} nombre={(k) => k} />
          {e.porBroker.length > 0 && <TablaGrupos titulo="Por broker" grupos={e.porBroker} nombre={(k) => k} />}
        </div>
      </Seccion>
    </div>
  );
}
