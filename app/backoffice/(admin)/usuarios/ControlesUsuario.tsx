"use client";

// Rol (lista para cambiarlo) y Desactivar/Reactivar de un usuario, para el
// Super Admin. El cambio de rol pide confirmar y aplica de inmediato.

import { useState, useTransition } from "react";
import { ROLES, etiquetaRol } from "@/lib/roles";
import { changeAdminRoleAction, toggleAdminUserActiveAction, type UsuarioResult } from "./actions";

export function CambiarRol({ email, nombre, role, esYo }: { email: string; nombre: string; role: string; esYo: boolean }) {
  const [valor, setValor] = useState(role);
  const [r, setR] = useState<UsuarioResult | null>(null);
  const [pendiente, start] = useTransition();
  const cambiar = (nuevo: string) => {
    if (nuevo === valor) return;
    if (!window.confirm(`¿Cambiar a ${nombre} de ${etiquetaRol(valor)} a ${etiquetaRol(nuevo)}? Aplica desde su siguiente clic.`)) return;
    const antes = valor;
    setValor(nuevo);
    start(async () => {
      const x = await changeAdminRoleAction(email, nuevo);
      setR(x);
      if (!x.ok) setValor(antes);
    });
  };
  return (
    <div className="space-y-1">
      <label className="sr-only" htmlFor={`rol-${email}`}>Rol de {nombre}</label>
      <select
        id={`rol-${email}`}
        value={valor}
        disabled={pendiente}
        onChange={(e) => cambiar(e.target.value)}
        title={esYo ? "Tu propio rol de Super Admin te lo cambia otro Super Admin" : undefined}
        className="rounded-lg border border-black/10 bg-white px-2 py-1 text-sm focus:border-finbra-purple focus:outline-none disabled:opacity-50"
      >
        {ROLES.map((x) => (
          <option key={x.value} value={x.value}>{x.label}</option>
        ))}
      </select>
      {r && <p className={`text-xs ${r.ok ? "text-emerald-700" : "text-red-700"}`} role={r.ok ? "status" : "alert"}>{r.ok ? r.mensaje : r.error}</p>}
    </div>
  );
}

export function ActivarUsuario({ email, nombre, activo }: { email: string; nombre: string; activo: boolean }) {
  const [error, setError] = useState<string | null>(null);
  const [pendiente, start] = useTransition();
  const cambiar = () => {
    if (activo && !window.confirm(`¿Desactivar a ${nombre}? Deja de poder entrar al backoffice de inmediato.`)) return;
    start(async () => {
      const x = await toggleAdminUserActiveAction(email, !activo);
      setError(x.ok ? null : x.error);
    });
  };
  return (
    <div className="space-y-1">
      <button type="button" onClick={cambiar} disabled={pendiente} className="text-sm font-semibold text-finbra-purple hover:underline disabled:opacity-50">
        {pendiente ? "Guardando…" : activo ? "Desactivar" : "Reactivar"}
      </button>
      {error && <p className="text-xs text-red-700" role="alert">{error}</p>}
    </div>
  );
}
