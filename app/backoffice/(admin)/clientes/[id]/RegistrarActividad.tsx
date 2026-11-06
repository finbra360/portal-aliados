"use client";

import { useActionState, useState } from "react";
import { RESULTADOS_ACTIVIDAD, TIPOS_ACTIVIDAD } from "@/lib/clientes/personas";
import { enviarSinBorrar } from "../../cobranza/enviarSinBorrar";
import { registrarActividadAction, type EmpresaActionResult } from "./actions";

const input = "w-full rounded-lg border border-black/10 bg-white px-3 py-1.5 text-sm";

/** Formulario para registrar una llamada, reunión, correo, WhatsApp, visita o nota con el cliente. */
export default function RegistrarActividad({ empresaId, personas }: { empresaId: string; personas: { id: string; nombre: string }[] }) {
  const [form, setForm] = useState(0);
  const [tipo, setTipo] = useState("llamada");
  const [state, accion, guardando] = useActionState(async (prev: EmpresaActionResult | null, fd: FormData) => {
    const r = await registrarActividadAction(empresaId, prev, fd);
    if (r.ok) {
      setForm((n) => n + 1);
      setTipo("llamada");
    }
    return r;
  }, null);
  return (
    <form key={form} onSubmit={enviarSinBorrar(accion)} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label htmlFor="act-tipo" className="space-y-1 text-sm">
          <span className="text-finbra-gray">Qué fue</span>
          <select id="act-tipo" name="tipo" value={tipo} onChange={(e) => setTipo(e.target.value)} className={input}>
            {Object.entries(TIPOS_ACTIVIDAD).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
        </label>
        <label htmlFor="act-persona" className="space-y-1 text-sm">
          <span className="text-finbra-gray">Con quién</span>
          <select id="act-persona" name="personaId" defaultValue="" className={input}>
            <option value="">—</option>
            {personas.map((p) => (
              <option key={p.id} value={p.id}>{p.nombre}</option>
            ))}
          </select>
        </label>
        {tipo !== "nota" && (
          <label htmlFor="act-resultado" className="space-y-1 text-sm">
            <span className="text-finbra-gray">Resultado</span>
            <select id="act-resultado" name="resultado" defaultValue="" className={input}>
              <option value="">—</option>
              {Object.entries(RESULTADOS_ACTIVIDAD).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
          </label>
        )}
        <label htmlFor="act-cuando" className="space-y-1 text-sm">
          <span className="text-finbra-gray">Cuándo (vacío = ahora)</span>
          <input id="act-cuando" name="ocurrido" type="datetime-local" className={input} />
        </label>
      </div>
      <label htmlFor="act-descripcion" className="block space-y-1 text-sm">
        <span className="text-finbra-gray">{tipo === "nota" ? "Nota" : "Qué se habló (opcional)"}</span>
        <textarea id="act-descripcion" name="descripcion" rows={2} maxLength={4000} required={tipo === "nota"} className={input} />
      </label>
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={guardando} className="rounded-lg bg-finbra-purple px-4 py-2 text-sm font-semibold text-white hover:bg-finbra-purple/90 disabled:opacity-50">
          {guardando ? "Guardando…" : "Registrar"}
        </button>
        {state && (state.ok ? <p className="text-sm text-emerald-700" role="status">{state.mensaje}</p> : <p className="text-sm text-red-700" role="alert">{state.error}</p>)}
      </div>
    </form>
  );
}
