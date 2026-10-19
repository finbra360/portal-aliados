"use client";

import { useState, useTransition } from "react";
import { ETAPAS } from "@/lib/collections/gestiones";
import { formatFecha, formatFechaHora, formatMoney } from "@/lib/format";
import { atenderAlertaAction, cambiarEtapaAction, resolverPromesaAction, saldoAlDiaAction, type ActionResult } from "./actions";

const chico = "rounded-lg px-2 py-1 text-xs font-medium disabled:opacity-50";

function useAccion() {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const correr = (fn: () => Promise<ActionResult>) =>
    start(async () => {
      setError(null);
      const r = await fn();
      if (!r.ok) setError(r.error);
    });
  return { pending, error, correr };
}

export function AlertActions({ clientId, alertId }: { clientId: string; alertId: number }) {
  const { pending, error, correr } = useAccion();
  return (
    <span className="flex flex-wrap items-center gap-1">
      <button type="button" disabled={pending} onClick={() => correr(() => atenderAlertaAction(clientId, alertId, "atendida"))} className={`${chico} bg-finbra-purple/10 text-finbra-purple-700 hover:bg-finbra-purple/20`}>
        Atendida
      </button>
      <button type="button" disabled={pending} onClick={() => correr(() => atenderAlertaAction(clientId, alertId, "descartada"))} className={`${chico} text-finbra-gray hover:bg-black/5`}>
        Descartar
      </button>
      {error && <span className="text-xs text-red-700" role="alert">{error}</span>}
    </span>
  );
}

export function PromiseActions({ clientId, promiseId }: { clientId: string; promiseId: number }) {
  const { pending, error, correr } = useAccion();
  return (
    <span className="flex flex-wrap items-center gap-1">
      <button type="button" disabled={pending} onClick={() => correr(() => resolverPromesaAction(clientId, promiseId, "cumplida"))} className={`${chico} bg-emerald-100 text-emerald-700 hover:bg-emerald-200`} title="Pagó, aunque SIAC todavía no lo refleje">
        Cumplida
      </button>
      <button type="button" disabled={pending} onClick={() => correr(() => resolverPromesaAction(clientId, promiseId, "cancelada"))} className={`${chico} text-finbra-gray hover:bg-black/5`}>
        Cancelar
      </button>
      {error && <span className="text-xs text-red-700" role="alert">{error}</span>}
    </span>
  );
}

export function EtapaSelect({ clientId, creditId, etapa }: { clientId: string; creditId: string; etapa: string | null }) {
  const { pending, error, correr } = useAccion();
  return (
    <span className="flex flex-col gap-1">
      <label className="sr-only" htmlFor={`etapa-${creditId}`}>Etapa</label>
      <select
        id={`etapa-${creditId}`}
        value={etapa === "juridico" || etapa === "reestructura" ? etapa : ""}
        disabled={pending}
        onChange={(e) => correr(() => cambiarEtapaAction(clientId, creditId, e.target.value))}
        className="rounded-lg border border-black/10 bg-white px-2 py-1 text-xs"
      >
        <option value="">Cobranza normal</option>
        {Object.entries(ETAPAS).map(([k, v]) => (
          <option key={k} value={k}>{v}</option>
        ))}
      </select>
      {error && <span className="text-xs text-red-700" role="alert">{error}</span>}
    </span>
  );
}

export function SaldoAlDiaButton({
  clientId,
  creditId,
  ultimo,
}: {
  clientId: string;
  creditId: string;
  ultimo: { fechaCorte: string; saldoVencido: number; totalPagar: number; consultadoAt: string } | null;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saldo, setSaldo] = useState(ultimo);
  const [otraFecha, setOtraFecha] = useState(false);
  const [fecha, setFecha] = useState("");
  const consultar = (fechaCorte?: string) =>
    start(async () => {
      setError(null);
      const r = await saldoAlDiaAction(clientId, creditId, fechaCorte);
      if (r.ok) setSaldo(r.saldo);
      else setError(r.error);
    });
  // Una consulta a otra fecha (por ejemplo, el próximo vencimiento) se marca para no confundirla con el saldo de hoy.
  const diaConsulta = saldo ? new Intl.DateTimeFormat("en-CA", { timeZone: "America/Mexico_City" }).format(new Date(saldo.consultadoAt)) : null;
  return (
    <span className="flex flex-col items-start gap-1">
      {saldo && (
        // Lo exigible es el saldo vencido a esa fecha (a una fecha de vencimiento, la mensualidad).
        // El "total a pagar" de SIAC es lo que haría falta para liquidar el crédito completo.
        <span className="text-xs">
          {saldo.fechaCorte !== diaConsulta ? <>A pagar el {formatFecha(saldo.fechaCorte)}</> : "Vencido hoy"} <strong>{formatMoney(saldo.saldoVencido)}</strong>
          <span className="block text-finbra-gray">Para liquidar: {formatMoney(saldo.totalPagar)}</span>
          <span className="block text-finbra-gray">{formatFechaHora(saldo.consultadoAt)}</span>
        </span>
      )}
      <span className="flex items-center gap-1">
        <button
          type="button"
          disabled={pending}
          onClick={() => consultar()}
          className={`${chico} bg-finbra-purple/10 text-finbra-purple-700 hover:bg-finbra-purple/20`}
          title="Consulta a SIAC el saldo de este crédito a hoy"
        >
          {pending ? "Consultando…" : saldo ? "Actualizar" : "Saldo al día"}
        </button>
        <button type="button" onClick={() => setOtraFecha((v) => !v)} className={`${chico} text-finbra-gray hover:bg-black/5`} title="Consultar lo que deberá a otra fecha">
          Otra fecha
        </button>
      </span>
      {otraFecha && (
        <span className="flex items-center gap-1">
          <input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} className="rounded border border-black/10 px-1 py-0.5 text-xs" aria-label="Fecha de corte" />
          <button type="button" disabled={pending || !fecha} onClick={() => consultar(fecha)} className={`${chico} bg-finbra-purple/10 text-finbra-purple-700 hover:bg-finbra-purple/20`}>
            Consultar
          </button>
        </span>
      )}
      {error && <span className="max-w-48 text-xs text-red-700" role="alert">{error}</span>}
    </span>
  );
}
