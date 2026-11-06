"use client";

import { useActionState, useState } from "react";
import { TIPOS_TAREA } from "@/lib/clientes/tareas";
import { enviarSinBorrar } from "../../cobranza/enviarSinBorrar";
import { crearTareaAction, type EmpresaActionResult } from "./actions";

const input = "w-full rounded-lg border border-black/10 bg-white px-3 py-1.5 text-sm";

/** Formulario para crear una tarea sobre la empresa. `hoy` llega del servidor (hora de Ciudad de México). */
export default function NuevaTarea({
  empresaId,
  hoy,
  ejecutivos,
  responsablePorOmision,
}: {
  empresaId: string;
  hoy: string;
  ejecutivos: { email: string; nombre: string }[];
  responsablePorOmision: string | null;
}) {
  const [form, setForm] = useState(0);
  const [state, accion, guardando] = useActionState(async (prev: EmpresaActionResult | null, fd: FormData) => {
    const r = await crearTareaAction(empresaId, prev, fd);
    if (r.ok) setForm((n) => n + 1);
    return r;
  }, null);
  return (
    <form key={form} onSubmit={enviarSinBorrar(accion)} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label htmlFor="tarea-titulo" className="space-y-1 text-sm sm:col-span-2">
          <span className="text-finbra-gray">Qué hay que hacer</span>
          <input id="tarea-titulo" name="titulo" required maxLength={200} placeholder="Ej. Llamar para revisión trimestral" className={input} />
        </label>
        <label htmlFor="tarea-tipo" className="space-y-1 text-sm">
          <span className="text-finbra-gray">Tipo</span>
          <select id="tarea-tipo" name="tipo" defaultValue="seguimiento" className={input}>
            {Object.entries(TIPOS_TAREA).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
        </label>
        <label htmlFor="tarea-vence" className="space-y-1 text-sm">
          <span className="text-finbra-gray">Para cuándo</span>
          <input id="tarea-vence" name="venceEl" type="date" required min={hoy} defaultValue={hoy} className={input} />
        </label>
        <label htmlFor="tarea-responsable" className="space-y-1 text-sm sm:col-span-2">
          <span className="text-finbra-gray">Responsable</span>
          <select id="tarea-responsable" name="responsableEmail" defaultValue={responsablePorOmision ?? ""} className={input}>
            <option value="">El ejecutivo del cliente (o yo, si no tiene)</option>
            {ejecutivos.map((e) => (
              <option key={e.email} value={e.email}>{e.nombre}</option>
            ))}
          </select>
        </label>
        <label htmlFor="tarea-descripcion" className="space-y-1 text-sm sm:col-span-2">
          <span className="text-finbra-gray">Detalle (opcional)</span>
          <input id="tarea-descripcion" name="descripcion" maxLength={2000} className={input} />
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={guardando} className="rounded-lg bg-finbra-purple px-4 py-2 text-sm font-semibold text-white hover:bg-finbra-purple/90 disabled:opacity-50">
          {guardando ? "Guardando…" : "Crear tarea"}
        </button>
        {state && (state.ok ? <p className="text-sm text-emerald-700" role="status">{state.mensaje}</p> : <p className="text-sm text-red-700" role="alert">{state.error}</p>)}
      </div>
    </form>
  );
}
