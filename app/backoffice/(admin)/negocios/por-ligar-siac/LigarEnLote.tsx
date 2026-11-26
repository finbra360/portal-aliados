"use client";

// «Por ligar con SIAC»: cada negocio dispersado sin crédito, con sus
// sugerencias y un «Es este» en cada una. «Ligar los N seguros» liga de una vez
// los que tienen una sugerencia clara (ligasSeguras). «No tiene crédito en
// SIAC» lo saca de la lista. Lo ligado o descartado sale de la lista.

import { useState, useTransition } from "react";
import Link from "next/link";
import { formatFecha, formatMoney } from "@/lib/format";
import type { RenglonPorLigar } from "@/lib/db/por-ligar-siac";
import { ligarCreditoSiacAction, ligarSiacEnLoteAction, sinCreditoSiacAction } from "../actions";

const BASE = "/backoffice/negocios";
const boton = "rounded-lg bg-finbra-purple px-3 py-1.5 text-sm font-semibold text-white hover:bg-finbra-purple/90 disabled:opacity-50";
const secundario = "rounded-lg border border-black/10 px-3 py-1.5 text-sm hover:bg-black/5 disabled:opacity-50";
const AVISO = "¿Ligar este negocio con el crédito? Si SIAC le creó otra empresa al cliente, se junta con la del negocio y no se puede deshacer.";

function Fila({ r, segura, onListo }: { r: RenglonPorLigar; segura: string | null; onListo: (texto: string) => void }) {
  const [error, setError] = useState<string | null>(null);
  const [pendiente, start] = useTransition();
  const ligar = (creditId: string, noCredito: string) => {
    if (!window.confirm(AVISO)) return;
    start(async () => {
      setError(null);
      const x = await ligarSiacEnLoteAction([{ id: r.id, creditId }]);
      if (x.ok) onListo(`${r.empresa}: ligado al crédito ${noCredito}.`);
      else setError(x.error);
    });
  };
  const [numero, setNumero] = useState("");
  const ligarNumero = () => {
    const no = numero.trim();
    if (!no || !window.confirm(AVISO)) return;
    start(async () => {
      setError(null);
      const fd = new FormData();
      fd.set("noCredito", no);
      const x = await ligarCreditoSiacAction(r.id, null, fd);
      if (x.ok) onListo(`${r.empresa}: ${x.mensaje}`);
      else setError(x.error);
    });
  };
  const sinCredito = () => {
    if (!window.confirm(`¿${r.empresa} no tiene crédito en SIAC? Deja de pedirse ligar aquí y en Inicio; se puede ligar después desde su ficha.`)) return;
    start(async () => {
      setError(null);
      const x = await sinCreditoSiacAction(r.id);
      if (x.ok) onListo(`${r.empresa}: se queda sin crédito de SIAC.`);
      else setError(x.error);
    });
  };
  return (
    <li className="space-y-2 py-4 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-center gap-2">
        <Link href={`${BASE}/${r.id}`} className="font-semibold hover:text-finbra-purple hover:underline">{r.empresa}</Link>
        <span className="text-sm text-finbra-gray">
          {r.monto !== null ? `${formatMoney(r.monto)} · ` : ""}dispersado el {formatFecha(r.dispersadoEl)}
        </span>
      </div>
      {r.nombreHubspot && <p className="text-xs text-finbra-gray">En HubSpot: «{r.nombreHubspot}»</p>}
      {r.sugerencias.length > 0 ? (
        <ul className="divide-y divide-black/5 rounded-lg border border-black/5">
          {r.sugerencias.slice(0, 3).map((s) => (
            <li key={s.creditId} className="flex flex-wrap items-center justify-between gap-3 px-3 py-2 text-sm">
              <div className="min-w-0 flex-1">
                <p>
                  <span className="font-semibold">{s.cliente}</span>
                  <span className="text-finbra-gray"> · crédito {s.noCredito}</span>
                  {s.monto !== null && <span className="tabular-nums"> · {formatMoney(s.monto)}</span>}
                  {segura === s.creditId && (
                    <span className="ml-2 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-800">Seguro</span>
                  )}
                </p>
                <p className="text-xs text-finbra-gray">{s.razones.join(" · ")}</p>
              </div>
              <button type="button" onClick={() => ligar(s.creditId, s.noCredito)} disabled={pendiente} className={boton}>
                {pendiente ? "Guardando…" : "Es este"}
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-finbra-gray">Sin sugerencias: no hay en SIAC un crédito libre con nombre, monto o fecha parecidos. Si sabes cuál es, escribe su número.</p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <label className="sr-only" htmlFor={`no-${r.id}`}>Número de crédito de SIAC de {r.empresa}</label>
        <input
          id={`no-${r.id}`}
          value={numero}
          onChange={(e) => setNumero(e.target.value)}
          maxLength={40}
          placeholder={r.sugerencias.length > 0 ? "¿Otro? Número de crédito" : "Número de crédito"}
          className="w-48 rounded-lg border border-black/10 bg-white px-3 py-1.5 font-mono text-sm focus:border-finbra-purple focus:outline-none"
        />
        <button type="button" onClick={ligarNumero} disabled={pendiente || !numero.trim()} className={secundario}>
          Ligar
        </button>
        <button type="button" onClick={sinCredito} disabled={pendiente} className={secundario}>
          No tiene crédito en SIAC
        </button>
        {error && <p className="w-full text-sm text-red-700" role="alert">{error}</p>}
      </div>
    </li>
  );
}

export default function LigarEnLote({ renglones, seguras }: { renglones: RenglonPorLigar[]; seguras: { id: string; creditId: string }[] }) {
  const [hechos, setHechos] = useState<Set<string>>(new Set());
  const [aviso, setAviso] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendiente, start] = useTransition();

  const visibles = renglones.filter((r) => !hechos.has(r.id));
  const seguraDe = new Map(seguras.filter((s) => !hechos.has(s.id)).map((s) => [s.id, s.creditId]));
  const porLigar = [...seguraDe.entries()].map(([id, creditId]) => ({ id, creditId }));
  // Seguros primero, luego los demás con sugerencia; los que no tienen, al final y plegados.
  const conSugerencia = [...visibles.filter((r) => seguraDe.has(r.id)), ...visibles.filter((r) => !seguraDe.has(r.id) && r.sugerencias.length > 0)];
  const sinSugerencia = visibles.filter((r) => r.sugerencias.length === 0);
  const listo = (id: string) => (texto: string) => {
    setAviso(texto);
    setHechos((s) => new Set(s).add(id));
  };

  const ligarSeguros = () => {
    const n = porLigar.length;
    if (!window.confirm(`¿Ligar ${n === 1 ? "el negocio seguro" : `los ${n} negocios seguros`} con su crédito? Si SIAC le creó otra empresa a un cliente, se junta con la del negocio y no se puede deshacer. Cada uno queda en el Audit Log.`)) return;
    start(async () => {
      setError(null);
      const x = await ligarSiacEnLoteAction(porLigar);
      if (x.ligados?.length) setHechos((s) => new Set([...s, ...x.ligados!]));
      if (x.ok) setAviso(x.mensaje);
      else setError(x.error);
    });
  };

  if (visibles.length === 0) {
    return (
      <div className="space-y-3">
        {aviso && <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800" role="status">{aviso}</p>}
        <p className="text-sm text-finbra-gray">Todos los negocios dispersados ya están ligados a su crédito de SIAC o marcados sin crédito.</p>
      </div>
    );
  }
  return (
    <div className="space-y-4">
      {aviso && <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800" role="status">{aviso}</p>}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-finbra-gray">
          {visibles.length} por ligar · {conSugerencia.length} con sugerencia{porLigar.length > 0 ? ` · ${porLigar.length} ${porLigar.length === 1 ? "seguro" : "seguros"}` : ""}
        </p>
        {porLigar.length > 0 && (
          <button type="button" onClick={ligarSeguros} disabled={pendiente} className={boton}>
            {pendiente ? "Ligando…" : porLigar.length === 1 ? "Ligar el seguro" : `Ligar los ${porLigar.length} seguros`}
          </button>
        )}
      </div>
      {error && <p className="text-sm text-red-700" role="alert">{error}</p>}
      {conSugerencia.length > 0 && (
        <ul className="divide-y divide-black/5">
          {conSugerencia.map((r) => (
            <Fila key={r.id} r={r} segura={seguraDe.get(r.id) ?? null} onListo={listo(r.id)} />
          ))}
        </ul>
      )}
      {sinSugerencia.length > 0 && (
        <details className="rounded-lg border border-black/5 px-4 py-3" open={conSugerencia.length === 0}>
          <summary className="cursor-pointer text-sm font-semibold">
            {sinSugerencia.length} sin sugerencia
          </summary>
          <ul className="mt-3 divide-y divide-black/5">
            {sinSugerencia.map((r) => (
              <Fila key={r.id} r={r} segura={null} onListo={listo(r.id)} />
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
