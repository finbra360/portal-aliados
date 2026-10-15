"use client";

import { useActionState, useState, useTransition } from "react";
import type { Colocacion } from "@/lib/brokers/colocacion";
import { formatCurrency } from "@/lib/format";
import {
  crearColocacionAction,
  editarColocacionAction,
  eliminarColocacionAction,
  type ColocacionActionResult,
} from "../colocacion-actions";
import { enviarSinBorrar } from "../../cobranza/enviarSinBorrar";

const input = "w-full rounded-lg border border-black/10 bg-white px-3 py-1.5 text-sm";
const boton = "rounded-lg bg-finbra-purple px-4 py-2 text-sm font-semibold text-white hover:bg-finbra-purple/90 disabled:opacity-50";
const chico = "rounded-lg px-3 py-1.5 text-xs font-medium disabled:opacity-50";

export interface LineaColocacion extends Colocacion {
  /** Comisión del broker por esta operación (base + bono). null si el % de apertura no está en la tabla. */
  comisionBroker: number | null;
}

function Aviso({ state }: { state: ColocacionActionResult | null }) {
  if (!state) return null;
  return state.ok ? (
    state.mensaje ? <p className="text-sm text-emerald-700" role="status">{state.mensaje}</p> : null
  ) : (
    <p className="text-sm text-red-700" role="alert">{state.error}</p>
  );
}

function Campos({ c, hoy }: { c?: Colocacion; hoy: string }) {
  return (
    <div className="grid gap-3 sm:grid-cols-5">
      <label className="space-y-1 text-sm">
        <span className="text-finbra-gray">Fecha</span>
        <input name="fecha" type="date" required max={hoy} defaultValue={c?.fecha} className={input} />
      </label>
      <label className="space-y-1 text-sm">
        <span className="text-finbra-gray">Monto (MXN)</span>
        <input name="monto" required inputMode="decimal" placeholder="850000" defaultValue={c?.monto} className={input} />
      </label>
      <label className="space-y-1 text-sm">
        <span className="text-finbra-gray">Comisión apertura %</span>
        <input name="comisionAperturaPct" inputMode="decimal" placeholder="5" defaultValue={c?.comisionAperturaPct ?? ""} className={input} />
      </label>
      <label className="space-y-1 text-sm sm:col-span-2">
        <span className="text-finbra-gray">Referencia (cliente o crédito, opcional)</span>
        <input name="referencia" maxLength={120} defaultValue={c?.referencia ?? ""} className={input} />
      </label>
      <label className="flex items-center gap-2 text-sm sm:col-span-5">
        <input name="pagadoTotalidad" type="checkbox" defaultChecked={c?.pagadoTotalidad} />
        <span>El cliente ya pagó el crédito en su totalidad (bono para el broker)</span>
      </label>
    </div>
  );
}

function Nueva({ brokerId, hoy }: { brokerId: string; hoy: string }) {
  const [form, setForm] = useState(0);
  const [state, accion, guardando] = useActionState(async (prev: ColocacionActionResult | null, fd: FormData) => {
    const r = await crearColocacionAction(brokerId, prev, fd);
    if (r.ok) setForm((n) => n + 1);
    return r;
  }, null);
  return (
    <form key={form} onSubmit={enviarSinBorrar(accion)} className="space-y-3 rounded-xl border border-dashed border-black/10 p-4">
      <p className="font-semibold">Agregar operación</p>
      <Campos hoy={hoy} />
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={guardando} className={boton}>{guardando ? "Guardando…" : "Agregar"}</button>
        <Aviso state={state} />
      </div>
    </form>
  );
}

function Fila({ c, brokerId, hoy, puedeEditar }: { c: LineaColocacion; brokerId: string; hoy: string; puedeEditar: boolean }) {
  const [editando, setEditando] = useState(false);
  const [pending, start] = useTransition();
  const [resultado, setResultado] = useState<ColocacionActionResult | null>(null);
  const [state, accion, guardando] = useActionState(async (prev: ColocacionActionResult | null, fd: FormData) => {
    const r = await editarColocacionAction(brokerId, c.id, prev, fd);
    if (r.ok) setEditando(false);
    return r;
  }, null);

  if (editando) {
    return (
      <tr className="border-b border-black/5 last:border-0">
        <td colSpan={7} className="px-6 py-4">
          <form onSubmit={enviarSinBorrar(accion)} className="space-y-3">
            <Campos c={c} hoy={hoy} />
            <div className="flex flex-wrap items-center gap-3">
              <button type="submit" disabled={guardando} className={boton}>{guardando ? "Guardando…" : "Guardar"}</button>
              <button type="button" onClick={() => setEditando(false)} className={`${chico} text-finbra-gray hover:bg-black/5`}>Cancelar</button>
              <Aviso state={state} />
            </div>
          </form>
        </td>
      </tr>
    );
  }
  return (
    <tr className="border-b border-black/5 last:border-0">
      <td className="px-6 py-3 whitespace-nowrap">{c.fecha}</td>
      <td className="px-6 py-3 font-semibold">{formatCurrency(c.monto)}</td>
      <td className="px-6 py-3">{c.comisionAperturaPct === null ? <span className="text-amber-700">Sin capturar</span> : `${c.comisionAperturaPct}%`}</td>
      <td className="px-6 py-3">{c.comisionBroker === null ? <span className="text-amber-700">Por definir</span> : formatCurrency(c.comisionBroker)}</td>
      <td className="px-6 py-3">{c.pagadoTotalidad ? "Sí" : "No"}</td>
      <td className="px-6 py-3 text-finbra-gray">{c.referencia ?? "—"}</td>
      <td className="px-6 py-3 text-right whitespace-nowrap">
        {puedeEditar && (
          <span className="inline-flex gap-1">
            <button type="button" onClick={() => setEditando(true)} className={`${chico} bg-black/5 hover:bg-black/10`}>Editar</button>
            <button
              type="button"
              disabled={pending}
              onClick={() => {
                if (window.confirm(`¿Eliminar la operación del ${c.fecha} por ${formatCurrency(c.monto)}?`)) {
                  start(async () => setResultado(await eliminarColocacionAction(brokerId, c.id)));
                }
              }}
              className={`${chico} text-red-700 hover:bg-red-50`}
            >
              Eliminar
            </button>
          </span>
        )}
        {resultado && !resultado.ok && <Aviso state={resultado} />}
      </td>
    </tr>
  );
}

export default function ColocacionPanel({ brokerId, lineas, puedeEditar, hoy }: { brokerId: string; lineas: LineaColocacion[]; puedeEditar: boolean; hoy: string }) {
  return (
    <div className="space-y-4">
      {lineas.length === 0 ? (
        <p className="px-6 text-sm text-finbra-gray">Sin colocación registrada todavía.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead>
              <tr className="border-b border-black/5 text-xs uppercase tracking-wide text-finbra-gray">
                <th className="px-6 py-3">Fecha</th>
                <th className="px-6 py-3">Monto</th>
                <th className="px-6 py-3">Apertura</th>
                <th className="px-6 py-3">Comisión broker</th>
                <th className="px-6 py-3">Pagado</th>
                <th className="px-6 py-3">Referencia</th>
                <th className="px-6 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {lineas.map((c) => (
                <Fila key={c.id} c={c} brokerId={brokerId} hoy={hoy} puedeEditar={puedeEditar} />
              ))}
            </tbody>
          </table>
        </div>
      )}
      {puedeEditar && (
        <div className="px-6 pb-6">
          <Nueva brokerId={brokerId} hoy={hoy} />
        </div>
      )}
    </div>
  );
}
