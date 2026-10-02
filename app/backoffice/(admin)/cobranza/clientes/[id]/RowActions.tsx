"use client";

import { useState, useTransition } from "react";
import { ETAPAS } from "@/lib/collections/gestiones";
import { formatFechaHora, formatMoney } from "@/lib/format";
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
      <button type="button" disabled={pending} onClick={() => correr(() => atenderAlertaAction(clientId, alertId, "atendida"))} className={`${chico} bg-finbra-purple/10 text-finbra-purple hover:bg-finbra-purple/20`}>
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
  ultimo: { saldoVencido: number; totalPagar: number; consultadoAt: string } | null;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saldo, setSaldo] = useState(ultimo);
  return (
    <span className="flex flex-col items-start gap-1">
      {saldo && (
        <span className="text-xs">
          A pagar <strong>{formatMoney(saldo.totalPagar)}</strong>
          <span className="block text-finbra-gray">{formatFechaHora(saldo.consultadoAt)}</span>
        </span>
      )}
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          start(async () => {
            setError(null);
            const r = await saldoAlDiaAction(clientId, creditId);
            if (r.ok) setSaldo(r.saldo);
            else setError(r.error);
          })
        }
        className={`${chico} bg-finbra-purple/10 text-finbra-purple hover:bg-finbra-purple/20`}
        title="Consulta a SIAC el saldo de este crédito a hoy"
      >
        {pending ? "Consultando…" : saldo ? "Actualizar" : "Saldo al día"}
      </button>
      {error && <span className="max-w-48 text-xs text-red-700" role="alert">{error}</span>}
    </span>
  );
}
