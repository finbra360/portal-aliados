"use client";

// «Brokers sin asignar»: cada negocio de origen broker sin broker, con el
// broker sugerido (si hay pista) ya elegido en la lista. «Asignar» guarda ese
// renglón; «Asignar las N sugeridas» guarda de una vez las que apuntan a un
// solo broker. Lo asignado sale de la lista.

import { useState, useTransition } from "react";
import Link from "next/link";
import { formatFecha, formatMoney } from "@/lib/format";
import { sugerenciaUnica, type Pista } from "@/lib/clientes/brokers-sin-asignar";
import type { RenglonSinBroker } from "@/lib/db/brokers-sin-asignar";
import EtapaNegocioChip from "../EtapaNegocioChip";
import { asignarBrokersAction, renovacionSinBrokerAction } from "../actions";

const BASE = "/backoffice/negocios";
const boton = "rounded-lg bg-finbra-purple px-3 py-1.5 text-sm font-semibold text-white hover:bg-finbra-purple/90 disabled:opacity-50";
const secundario = "rounded-lg border border-black/10 px-3 py-1.5 text-sm hover:bg-black/5 disabled:opacity-50";
const campo = "w-full rounded-lg border border-black/10 bg-white px-3 py-1.5 text-sm focus:border-finbra-purple focus:outline-none sm:w-72";

type Broker = { id: string; nombre: string };

/** «3 renovaciones con pista»; vacío si son cero. */
const cuenta = (n: number, uno: string, varios: string) => (n === 0 ? "" : `${n} ${n === 1 ? uno : varios}`);

function TextoPista({ p, nombre }: { p: Pista; nombre: string }) {
  if (p.fuente === "empresa") return <>Otro negocio de esta empresa es de <span className="font-medium text-black">{nombre}</span>.</>;
  return (
    <>
      Se parece a un crédito de <span className="font-medium text-black">{nombre}</span>: «{p.referencia}»{p.fecha ? `, ${formatFecha(p.fecha)}` : ""}.
    </>
  );
}

function Fila({ r, brokers, nombreDe, onListo }: { r: RenglonSinBroker; brokers: Broker[]; nombreDe: (id: string) => string; onListo: (texto: string) => void }) {
  const [elegido, setElegido] = useState(r.pistas[0]?.brokerId ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pendiente, start] = useTransition();
  const asignar = () =>
    start(async () => {
      setError(null);
      const x = await asignarBrokersAction([{ id: r.id, brokerId: elegido }]);
      if (x.ok) onListo(`${r.empresa}: ahora es de ${nombreDe(elegido)}.`);
      else setError(x.error);
    });
  const noEsDeBroker = () =>
    start(async () => {
      setError(null);
      const x = await renovacionSinBrokerAction(r.id);
      if (x.ok) onListo(`${r.empresa}: la renovación se queda sin broker.`);
      else setError(x.error);
    });
  return (
    <li className="space-y-2 py-4 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-center gap-2">
        <Link href={`${BASE}/${r.id}`} className="font-semibold hover:text-finbra-purple hover:underline">{r.empresa}</Link>
        <EtapaNegocioChip etapa={r.etapa} />
        {r.renovacion && <span className="rounded-full bg-black/5 px-2.5 py-0.5 text-xs font-semibold text-finbra-gray">Renovación</span>}
        <span className="text-sm text-finbra-gray">
          {r.monto !== null ? `${formatMoney(r.monto)} · ` : ""}creado {formatFecha(r.creado)}
        </span>
      </div>
      {r.pistas.length > 0 ? (
        <ul className="space-y-0.5 text-sm text-finbra-gray">
          {r.pistas.map((p) => (
            <li key={p.brokerId}>
              <span aria-hidden="true">⇄ </span>
              <TextoPista p={p} nombre={nombreDe(p.brokerId)} />
            </li>
          ))}
          {r.pistas.length > 1 && <li className="text-amber-800">Hay más de un broker posible: revisa cuál es.</li>}
        </ul>
      ) : (
        <p className="text-sm text-finbra-gray">Sin pistas: ni otro negocio de la empresa ni la colocación dicen de quién es.</p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <label className="sr-only" htmlFor={`broker-${r.id}`}>Broker de {r.empresa}</label>
        <select id={`broker-${r.id}`} value={elegido} onChange={(e) => setElegido(e.target.value)} className={campo}>
          <option value="">Elige el broker…</option>
          {brokers.map((b) => (
            <option key={b.id} value={b.id}>{b.nombre} · {b.id}</option>
          ))}
        </select>
        <button type="button" onClick={asignar} disabled={!elegido || pendiente} className={boton}>
          {pendiente ? "Guardando…" : "Asignar"}
        </button>
        {r.renovacion && (
          <button type="button" onClick={noEsDeBroker} disabled={pendiente} className={secundario}>
            No es de broker
          </button>
        )}
        {error && <p className="w-full text-sm text-red-700" role="alert">{error}</p>}
      </div>
    </li>
  );
}

export default function AsignarBrokers({ renglones, brokers }: { renglones: RenglonSinBroker[]; brokers: Broker[] }) {
  const [hechos, setHechos] = useState<Set<string>>(new Set());
  const [aviso, setAviso] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendiente, start] = useTransition();
  const nombres = new Map(brokers.map((b) => [b.id, b.nombre]));
  const nombreDe = (id: string) => nombres.get(id) ?? id;

  const visibles = renglones.filter((r) => !hechos.has(r.id));
  // Con pista primero; dentro de cada grupo, el orden de la base (los más nuevos primero).
  const ordenados = [...visibles.filter((r) => r.pistas.length > 0), ...visibles.filter((r) => r.pistas.length === 0)];
  const seguras = visibles.flatMap((r) => {
    const b = sugerenciaUnica(r.pistas);
    return b ? [{ id: r.id, brokerId: b }] : [];
  });

  const asignarSugeridas = () => {
    if (!window.confirm(`¿Asignar el broker sugerido a ${seguras.length} ${seguras.length === 1 ? "negocio" : "negocios"}? Cada uno queda en el Audit Log y se puede cambiar después en su ficha.`)) return;
    start(async () => {
      setError(null);
      const x = await asignarBrokersAction(seguras);
      if (x.ok) {
        setAviso(x.mensaje);
        setHechos((s) => new Set([...s, ...seguras.map((p) => p.id)]));
      } else setError(x.error);
    });
  };

  if (visibles.length === 0) {
    return (
      <div className="space-y-3">
        {aviso && <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800" role="status">{aviso}</p>}
        <p className="text-sm text-finbra-gray">Todos los negocios de broker ya tienen su broker y no quedan renovaciones con pista por revisar.</p>
      </div>
    );
  }
  return (
    <div className="space-y-4">
      {aviso && <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800" role="status">{aviso}</p>}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-finbra-gray">
          {[
            cuenta(visibles.filter((r) => !r.renovacion).length, "de broker sin asignar", "de broker sin asignar"),
            cuenta(visibles.filter((r) => r.renovacion).length, "renovación con pista", "renovaciones con pista"),
            cuenta(visibles.filter((r) => r.pistas.length > 0).length, "con sugerencia", "con sugerencia"),
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
        {seguras.length > 0 && (
          <button type="button" onClick={asignarSugeridas} disabled={pendiente} className={boton}>
            {pendiente ? "Guardando…" : seguras.length === 1 ? "Asignar la sugerida" : `Asignar las ${seguras.length} sugeridas`}
          </button>
        )}
      </div>
      {error && <p className="text-sm text-red-700" role="alert">{error}</p>}
      <ul className="divide-y divide-black/5">
        {ordenados.map((r) => (
          <Fila
            key={r.id}
            r={r}
            brokers={brokers}
            nombreDe={nombreDe}
            onListo={(texto) => {
              setAviso(texto);
              setHechos((s) => new Set(s).add(r.id));
            }}
          />
        ))}
      </ul>
    </div>
  );
}
