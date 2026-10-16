"use client";

import { useActionState, useState } from "react";
import { crearAnuncioAction, type AnuncioResult } from "./actions";
import { enviarSinBorrar } from "../cobranza/enviarSinBorrar";
import { LIMITE_MENSAJE, LIMITE_TITULO } from "@/lib/anuncios";

const input = "w-full rounded-lg border border-black/10 bg-white px-3 py-1.5 text-sm";
const boton = "rounded-lg bg-finbra-purple px-4 py-2 text-sm font-semibold text-white hover:bg-finbra-purple/90 disabled:opacity-50";

export default function NuevoAnuncio() {
  const [form, setForm] = useState(0);
  const [aBrokers, setABrokers] = useState(false);
  const [state, accion, guardando] = useActionState(async (prev: AnuncioResult | null, fd: FormData) => {
    const r = await crearAnuncioAction(prev, fd);
    if (r.ok) {
      setForm((n) => n + 1);
      setABrokers(false);
    }
    return r;
  }, null);

  return (
    <form key={form} onSubmit={enviarSinBorrar(accion)} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="space-y-1 text-sm sm:col-span-2">
          <span className="text-finbra-gray">Título</span>
          <input name="titulo" required maxLength={LIMITE_TITULO} className={input} />
        </label>
        <label className="space-y-1 text-sm sm:col-span-2">
          <span className="text-finbra-gray">Mensaje</span>
          <textarea name="mensaje" required rows={3} maxLength={LIMITE_MENSAJE} className={input} />
        </label>
        <label className="space-y-1 text-sm">
          <span className="text-finbra-gray">Texto del botón (opcional)</span>
          <input name="ctaTexto" maxLength={40} placeholder="Ej. Ver concursos" className={input} />
        </label>
        <label className="space-y-1 text-sm">
          <span className="text-finbra-gray">Enlace del botón (https://… o /ranking)</span>
          <input name="ctaUrl" maxLength={300} placeholder="/concursos" className={input} />
        </label>
        <label className="space-y-1 text-sm">
          <span className="text-finbra-gray">Para quién</span>
          <select name="audiencia" onChange={(e) => setABrokers(e.target.value === "brokers")} className={input}>
            <option value="todos">Todos los brokers</option>
            <option value="brokers">Brokers específicos</option>
          </select>
        </label>
        <label className="space-y-1 text-sm">
          <span className="text-finbra-gray">Último día visible (opcional)</span>
          <input name="expiraEl" type="date" className={input} />
        </label>
        {aBrokers && (
          <label className="space-y-1 text-sm sm:col-span-2">
            <span className="text-finbra-gray">IDs de los brokers (separados por coma, espacio o salto de línea)</span>
            <textarea name="brokers" rows={2} placeholder="B001, FAPBR044" className={`${input} uppercase`} />
          </label>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={guardando} className={boton}>
          {guardando ? "Publicando…" : "Publicar ahora"}
        </button>
        {state &&
          (state.ok ? (
            <p className="text-sm text-emerald-700" role="status">{state.mensaje}</p>
          ) : (
            <p className="text-sm text-red-700" role="alert">{state.error}</p>
          ))}
      </div>
    </form>
  );
}
