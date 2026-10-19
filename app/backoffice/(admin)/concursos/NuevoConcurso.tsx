"use client";

import { useActionState, useState } from "react";
import { crearConcursoAction, type ConcursoResult } from "./actions";
import { enviarSinBorrar } from "../cobranza/enviarSinBorrar";

const input = "w-full rounded-lg border border-black/10 bg-white px-3 py-1.5 text-sm";
const boton = "rounded-lg bg-finbra-purple px-4 py-2 text-sm font-semibold text-white hover:bg-finbra-purple/90 disabled:opacity-50";

export default function NuevoConcurso() {
  const [form, setForm] = useState(0);
  const [criterio, setCriterio] = useState("monto");
  const [state, accion, guardando] = useActionState(async (prev: ConcursoResult | null, fd: FormData) => {
    const r = await crearConcursoAction(prev, fd);
    if (r.ok) {
      setForm((n) => n + 1);
      setCriterio("monto");
    }
    return r;
  }, null);

  return (
    <form key={form} onSubmit={enviarSinBorrar(accion)} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="space-y-1 text-sm sm:col-span-2">
          <span className="text-finbra-gray">Nombre</span>
          <input name="nombre" required maxLength={120} className={input} />
        </label>
        <label className="space-y-1 text-sm">
          <span className="text-finbra-gray">Gana quien tenga más…</span>
          <select name="criterio" value={criterio} onChange={(e) => setCriterio(e.target.value)} className={input}>
            <option value="monto">Monto colocado</option>
            <option value="operaciones">Número de operaciones</option>
          </select>
        </label>
        <label className="space-y-1 text-sm sm:col-span-3">
          <span className="text-finbra-gray">Descripción (opcional)</span>
          <input name="descripcion" maxLength={500} className={input} />
        </label>
        <label className="space-y-1 text-sm">
          <span className="text-finbra-gray">Inicio</span>
          <input name="fechaInicio" type="date" required className={input} />
        </label>
        <label className="space-y-1 text-sm">
          <span className="text-finbra-gray">Fin (ese día cuenta)</span>
          <input name="fechaFin" type="date" required className={input} />
        </label>
        <label className="space-y-1 text-sm">
          <span className="text-finbra-gray"># de ganadores</span>
          <input name="numGanadores" type="number" min={1} max={50} defaultValue={1} required className={input} />
        </label>
        <label className="space-y-1 text-sm">
          <span className="text-finbra-gray">
            Meta para poder ganar (opcional, {criterio === "monto" ? "en pesos" : "en operaciones"})
          </span>
          <input name="meta" inputMode="decimal" placeholder={criterio === "monto" ? "1,000,000" : "5"} className={input} />
        </label>
        <label className="space-y-1 text-sm sm:col-span-2">
          <span className="text-finbra-gray">Premio</span>
          <input name="premio" required maxLength={200} className={input} />
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={guardando} className={boton}>
          {guardando ? "Guardando…" : "Crear (borrador)"}
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
