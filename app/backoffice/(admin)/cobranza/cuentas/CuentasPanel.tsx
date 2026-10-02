"use client";

import { useActionState, useState, useTransition } from "react";
import { formatClabe } from "@/lib/collections/payment-accounts";
import type { CuentaConUso } from "@/lib/db/payment-accounts";
import { asignarASinCuentaAction, crearCuentaAction, editarCuentaAction, setCuentaActivaAction, type CuentaActionResult } from "./actions";
import { enviarSinBorrar } from "../enviarSinBorrar";

const input = "w-full rounded-lg border border-black/10 bg-white px-3 py-1.5 text-sm";
const boton = "rounded-lg bg-finbra-purple px-4 py-2 text-sm font-semibold text-white hover:bg-finbra-purple/90 disabled:opacity-50";
const chico = "rounded-lg px-3 py-1.5 text-xs font-medium disabled:opacity-50";

function Aviso({ state }: { state: CuentaActionResult | null }) {
  if (!state) return null;
  return state.ok ? (
    state.mensaje ? <p className="text-sm text-emerald-700" role="status">{state.mensaje}</p> : null
  ) : (
    <p className="text-sm text-red-700" role="alert">{state.error}</p>
  );
}

function CamposCuenta({ cuenta }: { cuenta?: CuentaConUso }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="space-y-1 text-sm">
        <span className="text-finbra-gray">Nombre corto</span>
        <input name="alias" required maxLength={60} defaultValue={cuenta?.alias} placeholder="Ej. BBVA cobranza" className={input} />
      </label>
      <label className="space-y-1 text-sm">
        <span className="text-finbra-gray">Banco</span>
        <input name="banco" required maxLength={60} defaultValue={cuenta?.banco} placeholder="Ej. BBVA" className={input} />
      </label>
      <label className="space-y-1 text-sm sm:col-span-2">
        <span className="text-finbra-gray">Beneficiario (a nombre de quién está)</span>
        <input name="beneficiario" required maxLength={120} defaultValue={cuenta?.beneficiario} className={input} />
      </label>
    </div>
  );
}

function NuevaCuenta() {
  const [form, setForm] = useState(0);
  const [state, accion, guardando] = useActionState(async (prev: CuentaActionResult | null, fd: FormData) => {
    const r = await crearCuentaAction(prev, fd);
    if (r.ok) setForm((n) => n + 1);
    return r;
  }, null);
  return (
    <form key={form} onSubmit={enviarSinBorrar(accion)} className="space-y-3">
      <CamposCuenta />
      <label className="block space-y-1 text-sm">
        <span className="text-finbra-gray">CLABE (18 dígitos)</span>
        <input name="clabe" required inputMode="numeric" autoComplete="off" placeholder="000 000 00000000000 0" className={`${input} font-mono`} />
      </label>
      <p className="text-xs text-finbra-gray">Se revisa el dígito verificador. La CLABE no se puede editar después: si cambia, da de alta otra cuenta y reasigna a los clientes.</p>
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={guardando} className={boton}>{guardando ? "Guardando…" : "Dar de alta"}</button>
        <Aviso state={state} />
      </div>
    </form>
  );
}

function Cuenta({ cuenta, clientesSinCuenta }: { cuenta: CuentaConUso; clientesSinCuenta: number }) {
  const [editando, setEditando] = useState(false);
  const [pending, start] = useTransition();
  const [resultado, setResultado] = useState<CuentaActionResult | null>(null);
  const [state, accion, guardando] = useActionState(async (prev: CuentaActionResult | null, fd: FormData) => {
    const r = await editarCuentaAction(cuenta.id, prev, fd);
    if (r.ok) setEditando(false);
    setResultado(r);
    return r;
  }, null);
  const correr = (fn: () => Promise<CuentaActionResult>) =>
    start(async () => {
      setResultado(null);
      setResultado(await fn());
    });

  return (
    <li className={`space-y-3 rounded-xl border border-black/5 p-4 ${cuenta.activa ? "" : "bg-black/[0.02] text-finbra-gray"}`}>
      {editando ? (
        <form onSubmit={enviarSinBorrar(accion)} className="space-y-3">
          <CamposCuenta cuenta={cuenta} />
          <p className="text-sm">CLABE <span className="font-mono">{formatClabe(cuenta.clabe)}</span> (no se edita)</p>
          <div className="flex flex-wrap items-center gap-3">
            <button type="submit" disabled={guardando} className={boton}>{guardando ? "Guardando…" : "Guardar"}</button>
            <button type="button" onClick={() => setEditando(false)} className={`${chico} text-finbra-gray hover:bg-black/5`}>Cancelar</button>
            <Aviso state={state} />
          </div>
        </form>
      ) : (
        <>
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <p className="font-semibold">
                {cuenta.alias}
                {!cuenta.activa && <span className="ml-2 rounded-full bg-black/5 px-2 py-0.5 text-xs font-medium">Desactivada</span>}
              </p>
              <p className="text-sm">{cuenta.banco} · {cuenta.beneficiario}</p>
              <p className="font-mono text-sm">{formatClabe(cuenta.clabe)}</p>
            </div>
            <p className="text-sm text-finbra-gray">{cuenta.clientes === 1 ? "1 cliente paga aquí" : `${cuenta.clientes} clientes pagan aquí`}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => setEditando(true)} className={`${chico} bg-black/5 hover:bg-black/10`}>Editar</button>
            {cuenta.activa && clientesSinCuenta > 0 && (
              <button
                type="button"
                disabled={pending}
                onClick={() => {
                  const quienes = clientesSinCuenta === 1 ? "al cliente que no tiene cuenta" : `a los ${clientesSinCuenta} clientes que no tienen cuenta`;
                  if (window.confirm(`¿Asignar ${cuenta.alias} ${quienes}?`)) correr(() => asignarASinCuentaAction(cuenta.id));
                }}
                className={`${chico} bg-finbra-purple/10 text-finbra-purple hover:bg-finbra-purple/20`}
              >
                Asignar a {clientesSinCuenta === 1 ? "1 cliente" : `${clientesSinCuenta} clientes`} sin cuenta
              </button>
            )}
            <button
              type="button"
              disabled={pending}
              onClick={() => correr(() => setCuentaActivaAction(cuenta.id, !cuenta.activa))}
              className={`${chico} text-finbra-gray hover:bg-black/5`}
            >
              {cuenta.activa ? "Desactivar" : "Activar"}
            </button>
          </div>
          <Aviso state={resultado} />
        </>
      )}
    </li>
  );
}

export default function CuentasPanel({ cuentas, clientesSinCuenta }: { cuentas: CuentaConUso[]; clientesSinCuenta: number }) {
  return (
    <div className="space-y-6">
      {cuentas.length > 0 && (
        <ul className="space-y-3">
          {cuentas.map((c) => (
            <Cuenta key={c.id} cuenta={c} clientesSinCuenta={clientesSinCuenta} />
          ))}
        </ul>
      )}
      <div className="rounded-xl border border-dashed border-black/10 p-4">
        <h3 className="mb-3 font-semibold">Nueva cuenta</h3>
        <NuevaCuenta />
      </div>
    </div>
  );
}
