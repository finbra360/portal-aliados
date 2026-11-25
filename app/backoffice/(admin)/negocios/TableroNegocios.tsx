"use client";

// Tablero de negocios. Una columna por etapa abierta y una de «Cerrados» con
// pestañas (dispersados, pospuestos, rechazados). El tablero ocupa el alto de
// la pantalla y cada columna hace scroll por dentro, con su encabezado siempre
// visible: así una etapa con muchos negocios no estira la página ni esconde la
// barra para moverse a los lados. Arriba, una barra de etapas salta a cada
// columna y un buscador filtra por empresa.
//
// Quien opera originación arrastra una tarjeta a otra columna para moverla de
// etapa, con las mismas reglas que en la ficha (cambiarEtapa): avanzar pide los
// datos de la etapa; regresar pide el motivo. La tarjeta se mueve al instante y,
// si el servidor no lo deja, regresa con el porqué. Posponer, rechazar y
// dispersar se hacen en la ficha (piden fecha, motivo o crean la colocación):
// la columna de cerrados no recibe tarjetas. Un pospuesto o rechazado sí se
// puede arrastrar a una etapa abierta para reabrirlo.

import { useEffect, useLayoutEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ETAPAS_ABIERTAS, ETAPAS_NEGOCIO, ETIQUETA_ETAPA, PRODUCTOS, diasEnEtapa, estaAbierto, totalesPorEtapa, type EtapaNegocio } from "@/lib/clientes/negocios";
import { formatMoney } from "@/lib/format";
import type { Negocio } from "@/lib/db/negocios";
import { moverNegocioAction } from "./actions";

const BASE = "/backoffice/negocios";
const ORDEN = new Map(ETAPAS_NEGOCIO.map((e, i) => [e.value, i]));
/** Pestañas de la columna de cerrados. */
const CERRADAS: EtapaNegocio[] = ["dispersado", "pospuesto", "rechazado"];
const TITULO_CERRADA: Partial<Record<EtapaNegocio, string>> = { dispersado: "Dispersados", pospuesto: "Pospuestos", rechazado: "Rechazados" };
/** Tarjetas de cerrados que se muestran (las más recientes); el resto, en la lista. */
const MAX_CERRADAS = 40;
/** Días en la etapa desde los que la tarjeta se marca como atorada. */
const DIAS_ALERTA = 14;

/** Montos cortos para encabezados y tarjetas: $1.2 M, $850 k. */
function montoCorto(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toLocaleString("es-MX", { maximumFractionDigits: 1 })} M`;
  if (n >= 1_000) return `$${Math.round(n / 1_000).toLocaleString("es-MX")} k`;
  return formatMoney(n);
}

type Aviso = { tipo: "ok" | "error"; texto: string; id?: string; empresa?: string };

function Tarjeta({
  n,
  hoy,
  arrastrable,
  moviendo,
  onInicio,
  onFin,
}: {
  n: Negocio;
  hoy: string;
  arrastrable: boolean;
  moviendo: boolean;
  onInicio: () => void;
  onFin: () => void;
}) {
  const dias = diasEnEtapa(n.etapaDesde, hoy);
  const atorado = estaAbierto(n.etapa) && dias > DIAS_ALERTA;
  return (
    <li
      draggable={arrastrable && !moviendo}
      onDragStart={(e) => {
        e.dataTransfer.setData("text/plain", n.id);
        e.dataTransfer.effectAllowed = "move";
        onInicio();
      }}
      onDragEnd={onFin}
      className={`${arrastrable ? "cursor-grab active:cursor-grabbing" : ""} ${moviendo ? "animate-pulse opacity-60" : ""}`}
    >
      <Link
        href={`${BASE}/${n.id}`}
        draggable={false}
        title={n.empresa}
        className="group block rounded-lg border border-black/[0.06] bg-white px-3 py-2.5 shadow-sm transition hover:border-finbra-purple/40 hover:shadow-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-finbra-purple"
      >
        <p className="line-clamp-2 text-sm font-semibold leading-snug text-black [overflow-wrap:anywhere] group-hover:text-finbra-purple">{n.empresa}</p>
        <div className="mt-1.5 flex items-baseline justify-between gap-2">
          <span className="text-sm font-semibold tabular-nums text-finbra-purple-700">
            {n.montoEstimado !== null ? montoCorto(n.montoEstimado) : <span className="font-normal text-finbra-gray">Sin monto</span>}
          </span>
          {n.producto && <span className="truncate text-[11px] text-finbra-gray">{PRODUCTOS[n.producto]}{n.plazoMeses ? ` · ${n.plazoMeses} m` : ""}</span>}
        </div>
        <div className="mt-1.5 flex items-center justify-between gap-2 text-[11px] text-finbra-gray">
          <span className="truncate">{n.responsableNombre ?? "Sin responsable"}</span>
          <span
            className={`shrink-0 rounded-full px-1.5 py-0.5 tabular-nums ${atorado ? "bg-amber-100 font-semibold text-amber-800" : "bg-black/[0.04]"}`}
            title={atorado ? `Más de ${DIAS_ALERTA} días en esta etapa` : "Días en esta etapa"}
          >
            {moviendo ? "moviendo…" : dias === 0 ? "hoy" : `${dias} d`}
          </span>
        </div>
      </Link>
    </li>
  );
}

export default function TableroNegocios({
  negocios,
  hoy,
  puedeOperar,
  verTodos,
}: {
  negocios: Negocio[];
  hoy: string;
  puedeOperar: boolean;
  /** Liga a la lista de cada etapa cerrada. */
  verTodos: Record<string, string>;
}) {
  const router = useRouter();
  const [lista, setLista] = useState(negocios);
  const [arrastrando, setArrastrando] = useState<string | null>(null);
  const [encima, setEncima] = useState<EtapaNegocio | null>(null);
  const [moviendo, setMoviendo] = useState<string | null>(null);
  const [aviso, setAviso] = useState<Aviso | null>(null);
  const [busqueda, setBusqueda] = useState("");
  const [cerrada, setCerrada] = useState<EtapaNegocio>("pospuesto");
  const [, startTransition] = useTransition();

  // Cuando el servidor manda la lista otra vez (después de mover), se toma esa.
  const [deServidor, setDeServidor] = useState(negocios);
  if (deServidor !== negocios) {
    setDeServidor(negocios);
    setLista(negocios);
  }

  // El tablero ocupa lo que queda de pantalla debajo de él (al menos 26 rem).
  const tablero = useRef<HTMLDivElement>(null);
  const [alto, setAlto] = useState<number | null>(null);
  useLayoutEffect(() => {
    const medir = () => {
      const el = tablero.current;
      if (!el) return;
      const arriba = el.getBoundingClientRect().top + window.scrollY;
      // Debajo queda el margen inferior de la página (padding de <main>).
      const main = el.closest("main");
      const margen = main ? parseFloat(getComputedStyle(main).paddingBottom) || 0 : 0;
      setAlto(Math.max(416, window.innerHeight - arriba - margen - 8));
    };
    medir();
    window.addEventListener("resize", medir);
    return () => window.removeEventListener("resize", medir);
  }, []);

  // Los avisos de éxito se van solos; los errores se quedan hasta cerrarlos.
  useEffect(() => {
    if (aviso?.tipo !== "ok") return;
    const t = setTimeout(() => setAviso(null), 4000);
    return () => clearTimeout(t);
  }, [aviso]);

  const q = busqueda.trim().toLocaleLowerCase("es-MX");
  const visibles = useMemo(() => (q ? lista.filter((n) => n.empresa.toLocaleLowerCase("es-MX").includes(q)) : lista), [lista, q]);
  const totales = totalesPorEtapa(visibles);
  const totalAbierto = ETAPAS_ABIERTAS.reduce((s, e) => ({ n: s.n + totales[e].n, monto: s.monto + totales[e].monto }), { n: 0, monto: 0 });

  const irA = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", inline: "start", block: "nearest" });
  const desplazar = (dx: number) => tablero.current?.scrollBy({ left: dx, behavior: "smooth" });

  function soltar(etapa: EtapaNegocio, id: string) {
    setEncima(null);
    setArrastrando(null);
    const n = lista.find((x) => x.id === id);
    if (!n || n.etapa === etapa || moviendo) return;
    // Regresar es ir hacia atrás entre etapas abiertas; reabrir un pospuesto o rechazado no lo es.
    const regresa = estaAbierto(n.etapa) && (ORDEN.get(etapa) ?? 0) < (ORDEN.get(n.etapa) ?? 0);
    let motivo = "";
    if (regresa) {
      const r = window.prompt(`¿Por qué regresa «${n.empresa}» de ${ETIQUETA_ETAPA[n.etapa]} a ${ETIQUETA_ETAPA[etapa]}?`);
      if (r === null) return;
      motivo = r.trim();
      if (!motivo) {
        setAviso({ tipo: "error", texto: "Para regresar un negocio a una etapa anterior hay que escribir el motivo.", id: n.id, empresa: n.empresa });
        return;
      }
    }
    const antes = n.etapa;
    setLista((l) => l.map((x) => (x.id === id ? { ...x, etapa, etapaDesde: new Date().toISOString() } : x)));
    setMoviendo(id);
    setAviso(null);
    startTransition(async () => {
      const r = await moverNegocioAction(id, etapa, motivo);
      setMoviendo(null);
      if (!r.ok) {
        setLista((l) => l.map((x) => (x.id === id ? { ...x, etapa: antes, etapaDesde: n.etapaDesde } : x)));
        setAviso({ tipo: "error", texto: r.error, id: n.id, empresa: n.empresa });
        return;
      }
      setAviso({ tipo: "ok", texto: `«${n.empresa}» pasó a ${ETIQUETA_ETAPA[etapa]}.` });
      router.refresh();
    });
  }

  const finArrastre = () => {
    setArrastrando(null);
    setEncima(null);
  };

  const propsColumna = (e: EtapaNegocio) => ({
    onDragOver: (ev: React.DragEvent) => {
      if (!arrastrando) return;
      ev.preventDefault();
      ev.dataTransfer.dropEffect = "move";
      if (encima !== e) setEncima(e);
    },
    onDragLeave: (ev: React.DragEvent<HTMLElement>) => {
      if (!ev.currentTarget.contains(ev.relatedTarget as Node | null)) setEncima((x) => (x === e ? null : x));
    },
    onDrop: (ev: React.DragEvent) => {
      ev.preventDefault();
      const id = ev.dataTransfer.getData("text/plain") || arrastrando;
      if (id) soltar(e, id);
    },
  });

  const cerrados = visibles.filter((n) => n.etapa === cerrada).sort((a, b) => b.etapaDesde.localeCompare(a.etapaDesde));

  return (
    <div className="space-y-3">
      {/* Barra de etapas: resumen y atajo a cada columna. */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-56 flex-1 sm:max-w-xs">
          <input
            type="search"
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Buscar empresa…"
            aria-label="Buscar empresa en el tablero"
            className="w-full rounded-lg border border-black/10 bg-white py-2 pl-3 pr-3 text-sm"
          />
        </div>
        <p className="text-sm text-finbra-gray">
          {q ? `${visibles.length} ${visibles.length === 1 ? "coincidencia" : "coincidencias"} · ` : ""}
          <span className="font-semibold text-black">{totalAbierto.n}</span> abiertos · <span className="font-semibold tabular-nums text-black">{montoCorto(totalAbierto.monto)}</span>
        </p>
        {puedeOperar && (
          <p className="hidden text-xs text-finbra-gray xl:block" title="Para posponer, rechazar o dispersar, abre el negocio.">
            Arrastra una tarjeta para cambiarla de etapa.
          </p>
        )}
        <div className="ml-auto hidden gap-1 md:flex">
          <button type="button" onClick={() => desplazar(-560)} aria-label="Ver columnas anteriores" className="rounded-lg border border-black/10 bg-white px-2.5 py-1.5 text-sm hover:bg-black/5">
            ‹
          </button>
          <button type="button" onClick={() => desplazar(560)} aria-label="Ver columnas siguientes" className="rounded-lg border border-black/10 bg-white px-2.5 py-1.5 text-sm hover:bg-black/5">
            ›
          </button>
        </div>
      </div>
      <nav aria-label="Etapas" className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1">
        {ETAPAS_ABIERTAS.map((e) => (
          <button
            key={e}
            type="button"
            onClick={() => irA(`col-${e}`)}
            className="flex shrink-0 items-center gap-1.5 rounded-full bg-black/[0.04] px-3 py-1 text-xs text-finbra-gray hover:bg-finbra-purple/10 hover:text-finbra-purple"
          >
            {ETIQUETA_ETAPA[e]}
            <span className={`rounded-full px-1.5 tabular-nums ${totales[e].n ? "bg-white font-semibold text-black" : ""}`}>{totales[e].n}</span>
          </button>
        ))}
        <button
          type="button"
          onClick={() => irA("col-cerrados")}
          className="flex shrink-0 items-center gap-1.5 rounded-full border border-dashed border-black/15 px-3 py-1 text-xs text-finbra-gray hover:border-finbra-purple/40 hover:text-finbra-purple"
        >
          Cerrados
          <span className="tabular-nums">{CERRADAS.reduce((s, e) => s + totales[e].n, 0)}</span>
        </button>
      </nav>

      <div
        ref={tablero}
        style={alto ? { height: alto } : undefined}
        className="flex h-[70vh] snap-x snap-mandatory gap-3 overflow-x-auto overscroll-x-contain pb-2 md:snap-none"
      >
        {ETAPAS_ABIERTAS.map((e, i) => {
          const suyos = visibles.filter((n) => n.etapa === e);
          const destino = arrastrando !== null && encima === e;
          return (
            <section
              key={e}
              id={`col-${e}`}
              aria-label={ETIQUETA_ETAPA[e]}
              {...propsColumna(e)}
              className={`flex h-full w-[82vw] shrink-0 snap-start flex-col rounded-xl transition-colors sm:w-64 ${
                destino ? "bg-finbra-purple/10 ring-2 ring-inset ring-finbra-purple/50" : "bg-black/[0.035]"
              }`}
            >
              <header className="shrink-0 rounded-t-xl border-t-[3px] px-3 pb-2 pt-2.5" style={{ borderTopColor: `rgba(93, 91, 219, ${0.25 + (i / (ETAPAS_ABIERTAS.length - 1)) * 0.75})` }}>
                <div className="flex items-center justify-between gap-2">
                  <h2 className="text-xs font-bold uppercase tracking-wide text-black/70">{ETIQUETA_ETAPA[e]}</h2>
                  <span className="rounded-full bg-white px-2 py-0.5 text-xs font-semibold tabular-nums shadow-sm">{totales[e].n}</span>
                </div>
                <p className="mt-0.5 text-xs tabular-nums text-finbra-gray">{totales[e].monto ? montoCorto(totales[e].monto) : "—"}</p>
              </header>
              <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2 [scrollbar-width:thin]">
                {suyos.length === 0 ? (
                  <p className={`mx-1 mt-1 rounded-lg border border-dashed px-2 py-6 text-center text-xs ${destino ? "border-finbra-purple/50 text-finbra-purple" : "border-black/10 text-finbra-gray/70"}`}>
                    {destino ? "Suelta aquí" : q ? "Sin coincidencias" : "Sin negocios"}
                  </p>
                ) : (
                  <ul className="flex flex-col gap-2">
                    {suyos.map((n) => (
                      <Tarjeta
                        key={n.id}
                        n={n}
                        hoy={hoy}
                        arrastrable={puedeOperar}
                        moviendo={moviendo === n.id}
                        onInicio={() => setArrastrando(n.id)}
                        onFin={finArrastre}
                      />
                    ))}
                  </ul>
                )}
              </div>
            </section>
          );
        })}

        <section id="col-cerrados" aria-label="Cerrados" className="flex h-full w-[82vw] shrink-0 snap-start flex-col rounded-xl border border-dashed border-black/10 sm:w-64">
          <header className="shrink-0 px-3 pb-2 pt-2.5">
            <h2 className="text-xs font-bold uppercase tracking-wide text-black/70">Cerrados</h2>
            <div className="mt-2 flex gap-1" role="tablist" aria-label="Qué cerrados ver">
              {CERRADAS.map((e) => (
                <button
                  key={e}
                  type="button"
                  role="tab"
                  aria-selected={cerrada === e}
                  onClick={() => setCerrada(e)}
                  className={`flex-1 rounded-md px-1.5 py-1 text-[11px] font-medium ${cerrada === e ? "bg-finbra-purple text-white" : "bg-black/[0.04] text-finbra-gray hover:bg-black/10"}`}
                >
                  {TITULO_CERRADA[e]} <span className="tabular-nums">{totales[e].n}</span>
                </button>
              ))}
            </div>
            <p className="mt-1.5 text-xs tabular-nums text-finbra-gray">
              {totales[cerrada].monto ? montoCorto(totales[cerrada].monto) : "—"}
              {arrastrando && <span className="ml-1">· se cierran desde la ficha</span>}
            </p>
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2 [scrollbar-width:thin]">
            {cerrados.length === 0 ? (
              <p className="mx-1 mt-1 rounded-lg border border-dashed border-black/10 px-2 py-6 text-center text-xs text-finbra-gray/70">{q ? "Sin coincidencias" : "Sin negocios"}</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {cerrados.slice(0, MAX_CERRADAS).map((n) => (
                  <Tarjeta
                    key={n.id}
                    n={n}
                    hoy={hoy}
                    arrastrable={puedeOperar && n.etapa !== "dispersado"}
                    moviendo={moviendo === n.id}
                    onInicio={() => setArrastrando(n.id)}
                    onFin={finArrastre}
                  />
                ))}
              </ul>
            )}
            {cerrados.length > 0 && (
              <Link href={verTodos[cerrada]} className="mt-2 block px-1 text-xs font-semibold text-finbra-purple hover:underline">
                {cerrados.length > MAX_CERRADAS ? `Ver los ${cerrados.length} en la lista →` : "Ver en la lista →"}
              </Link>
            )}
          </div>
        </section>
      </div>

      {aviso && (
        <div
          className={`fixed bottom-5 left-1/2 z-50 flex w-[min(36rem,calc(100vw-2rem))] -translate-x-1/2 items-start gap-3 rounded-xl px-4 py-3 text-sm shadow-lg ${
            aviso.tipo === "ok" ? "bg-emerald-600 text-white" : "border border-red-200 bg-white text-red-700"
          }`}
          role={aviso.tipo === "ok" ? "status" : "alert"}
        >
          <p className="flex-1">
            {aviso.tipo === "error" && aviso.empresa && <span className="font-semibold">No se movió «{aviso.empresa}». </span>}
            {aviso.texto}
            {aviso.tipo === "error" && aviso.id && (
              <>
                {" "}
                <Link href={`${BASE}/${aviso.id}`} className="font-semibold underline">
                  Abrir el negocio
                </Link>
              </>
            )}
          </p>
          <button type="button" onClick={() => setAviso(null)} aria-label="Cerrar aviso" className="shrink-0 rounded px-1 opacity-70 hover:opacity-100">
            ✕
          </button>
        </div>
      )}
    </div>
  );
}
