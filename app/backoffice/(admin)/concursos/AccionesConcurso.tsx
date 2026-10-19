"use client";

import { useActionState, useState } from "react";
import { enviarSinBorrar } from "../cobranza/enviarSinBorrar";
import { excluirBrokerAction, finalizarConcursoAction, type ConcursoResult } from "./actions";

function Aviso({ state }: { state: ConcursoResult | null }) {
  if (!state) return null;
  return state.ok ? (
    <p className="text-sm text-emerald-700" role="status">{state.mensaje}</p>
  ) : (
    <p className="text-sm text-red-700" role="alert">{state.error}</p>
  );
}

/** Finalizar fija a los ganadores y no se puede deshacer: pide confirmar antes. */
export function FinalizarConcurso({ id, enCurso }: { id: number; enCurso: boolean }) {
  const [confirmando, setConfirmando] = useState(false);
  const [state, accion, guardando] = useActionState(finalizarConcursoAction.bind(null, id), null);

  return (
    <div className="space-y-2">
      {!confirmando ? (
        <button
          type="button"
          onClick={() => setConfirmando(true)}
          className="rounded-lg border border-finbra-purple/30 px-3 py-1.5 text-xs font-semibold text-finbra-purple hover:bg-finbra-purple/5"
        >
          Finalizar y fijar ganadores
        </button>
      ) : (
        <form action={accion} className="space-y-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          <p>
            {enCurso ? "El periodo todavía no termina. " : ""}
            Al finalizar se guardan los ganadores de hoy y ya no cambian, aunque después se corrija la colocación. No se puede deshacer.
          </p>
          <div className="flex gap-2">
            <button type="submit" disabled={guardando} className="rounded-lg bg-finbra-purple px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50">
              {guardando ? "Finalizando…" : "Sí, finalizar"}
            </button>
            <button type="button" onClick={() => setConfirmando(false)} className="rounded-lg px-3 py-1.5 text-xs text-finbra-gray hover:bg-black/5">
              Cancelar
            </button>
          </div>
        </form>
      )}
      <Aviso state={state} />
    </div>
  );
}

export function ExcluirBroker({ contestId }: { contestId: number }) {
  const [form, setForm] = useState(0);
  const [state, accion, guardando] = useActionState(async (prev: ConcursoResult | null, fd: FormData) => {
    const r = await excluirBrokerAction(contestId, prev, fd);
    if (r.ok) setForm((n) => n + 1);
    return r;
  }, null);

  return (
    <form key={form} onSubmit={enviarSinBorrar(accion)} className="flex flex-wrap items-center gap-2">
      <input
        name="brokerId"
        required
        autoComplete="off"
        placeholder="ID del broker"
        aria-label="ID del broker a excluir"
        className="w-40 rounded-lg border border-black/10 px-3 py-1.5 text-sm uppercase"
      />
      <button type="submit" disabled={guardando} className="rounded-lg border border-black/10 px-3 py-1.5 text-sm font-semibold text-finbra-purple disabled:opacity-50">
        Excluir
      </button>
      <Aviso state={state} />
    </form>
  );
}
