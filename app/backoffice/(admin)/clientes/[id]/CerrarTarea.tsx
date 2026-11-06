"use client";

import { useState, useTransition } from "react";
import { cerrarTareaAction } from "./actions";

/** Botones «Hecha» y «Cancelar» de una tarea abierta, con un resultado opcional. Se usa en la ficha y en Inicio. */
export default function CerrarTarea({ empresaId, tareaId }: { empresaId: string; tareaId: string }) {
  const [modo, setModo] = useState<"hecha" | "cancelada" | null>(null);
  const [resultado, setResultado] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  if (!modo) {
    return (
      <span className="flex flex-wrap items-center gap-1">
        <button type="button" onClick={() => setModo("hecha")} className="rounded-lg bg-emerald-100 px-2.5 py-1 text-xs font-semibold text-emerald-800 hover:bg-emerald-200">
          Hecha
        </button>
        <button type="button" onClick={() => setModo("cancelada")} className="rounded-lg px-2.5 py-1 text-xs font-medium text-finbra-gray hover:bg-black/5">
          Cancelar
        </button>
      </span>
    );
  }
  const id = `resultado-${tareaId}`;
  return (
    <span className="flex w-full flex-wrap items-center gap-2">
      <label htmlFor={id} className="sr-only">{modo === "hecha" ? "Resultado" : "Por qué se cancela"}</label>
      <input
        id={id}
        value={resultado}
        onChange={(e) => setResultado(e.target.value)}
        maxLength={2000}
        autoFocus
        placeholder={modo === "hecha" ? "Resultado (opcional)" : "Por qué se cancela (opcional)"}
        className="min-w-0 flex-1 rounded-lg border border-black/10 bg-white px-2 py-1 text-xs"
      />
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          start(async () => {
            setError(null);
            const r = await cerrarTareaAction(empresaId, tareaId, modo, resultado);
            if (!r.ok) setError(r.error);
          })
        }
        className="rounded-lg bg-finbra-purple px-2.5 py-1 text-xs font-semibold text-white disabled:opacity-50"
      >
        {pending ? "…" : modo === "hecha" ? "Marcar hecha" : "Cancelar tarea"}
      </button>
      <button type="button" onClick={() => setModo(null)} className="text-xs text-finbra-gray hover:underline">Volver</button>
      {error && <span className="text-xs text-red-700" role="alert">{error}</span>}
    </span>
  );
}
