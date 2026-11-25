"use client";

// Tablero de negocios: una columna por etapa abierta y, al final, las de los
// cerrados (dispersados, pospuestos y rechazados, los más recientes primero,
// con liga a la lista completa). Quien opera originación
// puede arrastrar una tarjeta a otra columna para moverla de etapa, con las
// mismas reglas que en la ficha (cambiarEtapa): avanzar pide los datos de la
// etapa; regresar pide el motivo. La tarjeta se mueve al instante y, si el
// servidor no lo deja, regresa a su lugar con el porqué. Posponer, rechazar y
// dispersar se hacen en la ficha, porque piden fecha, motivo o crean la
// colocación: esas columnas no reciben tarjetas. Un pospuesto o rechazado sí se
// puede arrastrar a una etapa abierta para reabrirlo.

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ETAPAS_ABIERTAS, ETAPAS_NEGOCIO, ETIQUETA_ETAPA, PRODUCTOS, diasEnEtapa, estaAbierto, totalesPorEtapa, type EtapaNegocio } from "@/lib/clientes/negocios";
import { formatMoney } from "@/lib/format";
import type { Negocio } from "@/lib/db/negocios";
import { moverNegocioAction } from "./actions";

const BASE = "/backoffice/negocios";
const ORDEN = new Map(ETAPAS_NEGOCIO.map((e, i) => [e.value, i]));
/** Columnas de cerrados, al final del tablero. */
const CERRADAS: EtapaNegocio[] = ["dispersado", "pospuesto", "rechazado"];
const TITULO_CERRADA: Partial<Record<EtapaNegocio, string>> = { dispersado: "Dispersados", pospuesto: "Pospuestos", rechazado: "Rechazados" };
/** Tarjetas que se muestran en cada columna de cerrados (las más recientes). */
const MAX_CERRADAS = 8;

type Aviso = { tipo: "ok" | "error"; texto: string; id?: string; empresa?: string };

function Tarjeta({ n, hoy, arrastrable, moviendo, onInicio, onFin }: {
  n: Negocio;
  hoy: string;
  arrastrable: boolean;
  moviendo: boolean;
  onInicio: () => void;
  onFin: () => void;
}) {
  const dias = diasEnEtapa(n.etapaDesde, hoy);
  return (
    <li
      draggable={arrastrable && !moviendo}
      onDragStart={(e) => {
        e.dataTransfer.setData("text/plain", n.id);
        e.dataTransfer.effectAllowed = "move";
        onInicio();
      }}
      onDragEnd={onFin}
      className={`${arrastrable ? "cursor-grab active:cursor-grabbing" : ""} ${moviendo ? "opacity-50" : ""}`}
    >
      <Link
        href={`${BASE}/${n.id}`}
        draggable={false}
        className="block space-y-1 rounded-lg border border-black/5 bg-white p-3 text-sm shadow-sm hover:border-finbra-purple/40"
      >
        <p className="break-words font-semibold leading-snug [overflow-wrap:anywhere]">{n.empresa}</p>
        <p className="tabular-nums">{n.montoEstimado !== null ? formatMoney(n.montoEstimado) : <span className="text-finbra-gray">Sin monto</span>}</p>
        {n.producto && (
          <p className="text-xs text-finbra-gray">
            {PRODUCTOS[n.producto]}
            {n.plazoMeses ? ` · ${n.plazoMeses} m` : ""}
          </p>
        )}
        <p className="flex flex-wrap items-center justify-between gap-x-2 text-xs text-finbra-gray">
          <span>{n.responsableNombre ?? "Sin responsable"}</span>
          <span className={dias > 14 ? "font-semibold text-amber-800" : ""}>{moviendo ? "moviendo…" : dias === 0 ? "hoy" : `${dias} ${dias === 1 ? "día" : "días"}`}</span>
        </p>
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
  const [, startTransition] = useTransition();

  // Cuando el servidor manda la lista otra vez (después de mover), se toma esa.
  const [deServidor, setDeServidor] = useState(negocios);
  if (deServidor !== negocios) {
    setDeServidor(negocios);
    setLista(negocios);
  }

  const totales = totalesPorEtapa(lista);

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
    // Se mueve al instante; si el servidor no lo deja, regresa.
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

  return (
    <div className="space-y-2">
      {puedeOperar && (
        <p className="text-xs text-finbra-gray">
          Arrastra una tarjeta a otra columna para moverla de etapa (también un pospuesto o rechazado, para reabrirlo). Para posponer, rechazar o marcar como
          dispersado, abre el negocio.
        </p>
      )}
      {aviso && (
        <p
          className={`rounded-lg px-3 py-2 text-sm ${aviso.tipo === "ok" ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-700"}`}
          role={aviso.tipo === "ok" ? "status" : "alert"}
        >
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
      )}
      <div className="overflow-x-auto pb-2">
        <div className="grid min-w-[1980px] grid-cols-11 gap-3">
          {ETAPAS_ABIERTAS.map((e) => {
            const suyos = lista.filter((n) => n.etapa === e);
            const destino = arrastrando !== null && encima === e;
            return (
              <section
                key={e}
                aria-label={ETIQUETA_ETAPA[e]}
                onDragOver={(ev) => {
                  if (!arrastrando) return;
                  ev.preventDefault();
                  ev.dataTransfer.dropEffect = "move";
                  if (encima !== e) setEncima(e);
                }}
                onDragLeave={(ev) => {
                  if (!ev.currentTarget.contains(ev.relatedTarget as Node | null)) setEncima((x) => (x === e ? null : x));
                }}
                onDrop={(ev) => {
                  ev.preventDefault();
                  const id = ev.dataTransfer.getData("text/plain") || arrastrando;
                  if (id) soltar(e, id);
                }}
                className={`flex min-w-0 flex-col gap-2 rounded-xl p-2 transition-colors ${destino ? "bg-finbra-purple/10 ring-2 ring-finbra-purple/40" : "bg-black/[0.03]"}`}
              >
                <header className="px-1">
                  <h2 className="text-xs font-bold uppercase tracking-wide text-finbra-gray">{ETIQUETA_ETAPA[e]}</h2>
                  <p className="text-xs tabular-nums text-finbra-gray">
                    {totales[e].n} · {formatMoney(totales[e].monto)}
                  </p>
                </header>
                {suyos.length === 0 ? (
                  <p className="px-1 py-3 text-xs text-finbra-gray/70">{destino ? "Suelta aquí" : "Sin negocios"}</p>
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
                        onFin={() => {
                          setArrastrando(null);
                          setEncima(null);
                        }}
                      />
                    ))}
                  </ul>
                )}
              </section>
            );
          })}
          {CERRADAS.map((e) => {
            const suyos = lista.filter((n) => n.etapa === e).sort((a, b) => b.etapaDesde.localeCompare(a.etapaDesde));
            return (
              <section key={e} aria-label={TITULO_CERRADA[e]} className="flex min-w-0 flex-col gap-2 rounded-xl border border-dashed border-black/10 p-2">
                <header className="px-1">
                  <h2 className="text-xs font-bold uppercase tracking-wide text-finbra-gray">{TITULO_CERRADA[e]}</h2>
                  <p className="text-xs tabular-nums text-finbra-gray">
                    {totales[e].n} · {formatMoney(totales[e].monto)}
                  </p>
                  {arrastrando && <p className="text-[11px] text-finbra-gray">Desde la ficha del negocio</p>}
                </header>
                {suyos.length === 0 ? (
                  <p className="px-1 py-3 text-xs text-finbra-gray/70">Sin negocios</p>
                ) : (
                  <ul className="flex flex-col gap-2">
                    {suyos.slice(0, MAX_CERRADAS).map((n) => (
                      <Tarjeta
                        key={n.id}
                        n={n}
                        hoy={hoy}
                        arrastrable={puedeOperar && e !== "dispersado"}
                        moviendo={moviendo === n.id}
                        onInicio={() => setArrastrando(n.id)}
                        onFin={() => {
                          setArrastrando(null);
                          setEncima(null);
                        }}
                      />
                    ))}
                  </ul>
                )}
                {suyos.length > 0 && (
                  <Link href={verTodos[e]} className="px-1 text-xs font-semibold text-finbra-purple hover:underline">
                    {suyos.length > MAX_CERRADAS ? `Ver los ${suyos.length} →` : "Ver en la lista →"}
                  </Link>
                )}
              </section>
            );
          })}
        </div>
      </div>
    </div>
  );
}
