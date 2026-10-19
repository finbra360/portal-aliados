"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import type { Broker } from "@/lib/db/brokers";
import { crearBrokerAction, editarBrokerAction, type BrokerActionResult } from "./actions";
import { enviarSinBorrar } from "../cobranza/enviarSinBorrar";

const input = "w-full rounded-lg border border-black/10 bg-white px-3 py-1.5 text-sm";
export const boton = "rounded-lg bg-finbra-purple px-4 py-2 text-sm font-semibold text-white hover:bg-finbra-purple/90 disabled:opacity-50";
export const botonSecundario = "rounded-lg border border-finbra-purple/30 px-4 py-2 text-sm font-semibold text-finbra-purple-700 hover:bg-finbra-purple/5";

export function Aviso({ state }: { state: BrokerActionResult | null }) {
  if (!state) return null;
  return state.ok ? (
    state.mensaje ? <p className="text-sm text-emerald-700" role="status">{state.mensaje}</p> : null
  ) : (
    <p className="text-sm text-red-700" role="alert">{state.error}</p>
  );
}

function Campos({ broker }: { broker?: Broker }) {
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <label className="space-y-1 text-sm">
        <span className="text-finbra-gray">Nombre completo</span>
        <input name="nombre" required maxLength={150} defaultValue={broker?.nombre} className={input} />
      </label>
      <label className="space-y-1 text-sm">
        <span className="text-finbra-gray">Correo (con este entra al portal)</span>
        <input name="email" type="email" required autoComplete="off" defaultValue={broker?.email} className={input} />
      </label>
      <label className="space-y-1 text-sm">
        <span className="text-finbra-gray">Teléfono (opcional)</span>
        <input name="telefono" inputMode="tel" autoComplete="off" placeholder="10 dígitos" defaultValue={broker?.telefono ?? ""} className={input} />
      </label>
    </div>
  );
}

/** Botones "Agregar broker" y "Carga masiva" con el formulario de alta. */
export function AgregarBroker() {
  const [abierto, setAbierto] = useState(false);
  const [form, setForm] = useState(0);
  const [state, accion, guardando] = useActionState(async (prev: BrokerActionResult | null, fd: FormData) => {
    const r = await crearBrokerAction(prev, fd);
    if (r.ok) setForm((n) => n + 1);
    return r;
  }, null);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => setAbierto((a) => !a)} className={boton}>
          {abierto ? "Cerrar" : "Agregar broker"}
        </button>
        <Link href="/backoffice/brokers/importar" className={botonSecundario}>
          Carga masiva
        </Link>
      </div>
      {abierto && (
        <form key={form} onSubmit={enviarSinBorrar(accion)} className="space-y-3 rounded-xl border border-dashed border-black/10 bg-white p-4">
          <Campos />
          <label className="block max-w-xs space-y-1 text-sm">
            <span className="text-finbra-gray">ID (código de Lendia, opcional)</span>
            <input name="id" autoComplete="off" placeholder="Ej. FAPBR044" maxLength={30} className={`${input} uppercase`} />
          </label>
          <p className="text-xs text-finbra-gray">Si no tiene código de Lendia, el ID se asigna solo (B001, B002…). No se puede cambiar después. Con el correo entra al portal de aliados.</p>
          <div className="flex flex-wrap items-center gap-3">
            <button type="submit" disabled={guardando} className={boton}>{guardando ? "Guardando…" : "Dar de alta"}</button>
            <Aviso state={state} />
          </div>
        </form>
      )}
      {!abierto && <Aviso state={state} />}
    </div>
  );
}

/** Datos del broker en su perfil, con edición para quien puede editar. */
export function DatosBroker({ broker, puedeEditar }: { broker: Broker; puedeEditar: boolean }) {
  const [editando, setEditando] = useState(false);
  const [state, accion, guardando] = useActionState(async (prev: BrokerActionResult | null, fd: FormData) => {
    const r = await editarBrokerAction(broker.id, prev, fd);
    if (r.ok) setEditando(false);
    return r;
  }, null);

  if (editando) {
    return (
      <form onSubmit={enviarSinBorrar(accion)} className="space-y-3">
        <Campos broker={broker} />
        <p className="text-xs text-finbra-gray">Si cambias el correo, el broker tendrá que entrar al portal con el nuevo.</p>
        <div className="flex flex-wrap items-center gap-3">
          <button type="submit" disabled={guardando} className={boton}>{guardando ? "Guardando…" : "Guardar"}</button>
          <button type="button" onClick={() => setEditando(false)} className="rounded-lg px-3 py-1.5 text-sm text-finbra-gray hover:bg-black/5">Cancelar</button>
          <Aviso state={state} />
        </div>
      </form>
    );
  }
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <dl className="grid gap-x-8 gap-y-2 text-sm sm:grid-cols-3">
        <div>
          <dt className="text-finbra-gray">Correo</dt>
          <dd className="font-medium">{broker.email}</dd>
        </div>
        <div>
          <dt className="text-finbra-gray">Teléfono</dt>
          <dd className="font-medium">{broker.telefono ?? "—"}</dd>
        </div>
        <div>
          <dt className="text-finbra-gray">Alta</dt>
          <dd className="font-medium">{new Date(broker.createdAt).toLocaleDateString("es-MX", { timeZone: "America/Mexico_City" })} · {broker.createdBy}</dd>
        </div>
      </dl>
      <div className="space-y-2 text-right">
        {puedeEditar && (
          <button type="button" onClick={() => setEditando(true)} className="rounded-lg bg-black/5 px-3 py-1.5 text-xs font-medium hover:bg-black/10">
            Editar datos
          </button>
        )}
        <Aviso state={state} />
      </div>
    </div>
  );
}
