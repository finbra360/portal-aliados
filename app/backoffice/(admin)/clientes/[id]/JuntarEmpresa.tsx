"use client";

// Juntar esta empresa (un prospecto, sin clientes de SIAC) con otra: todo pasa
// a la elegida y esta se borra. Al terminar lleva a la ficha de la que se queda.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { juntarEmpresaAction } from "../juntar-actions";

export default function JuntarEmpresa({ id, nombre, opciones }: { id: string; nombre: string; opciones: { id: string; nombre: string; esCliente: boolean }[] }) {
  const router = useRouter();
  const [destino, setDestino] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pendiente, start] = useTransition();
  const elegida = opciones.find((o) => o.id === destino);

  const juntar = () => {
    if (!elegida) return;
    if (!window.confirm(`¿Juntar «${nombre}» con «${elegida.nombre}»? Sus negocios, contactos y tareas pasan a «${elegida.nombre}» y «${nombre}» se borra. No se puede deshacer.`)) return;
    start(async () => {
      const r = await juntarEmpresaAction(elegida.id, id);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      router.push(`/backoffice/clientes/${r.queda}`);
    });
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-64 flex-1 space-y-1">
          <label htmlFor="juntarCon" className="block text-sm font-medium">Es la misma empresa que</label>
          <select id="juntarCon" value={destino} onChange={(e) => setDestino(e.target.value)} className="w-full rounded-lg border border-black/10 bg-white px-3 py-2 text-sm">
            <option value="">Elige la empresa</option>
            {opciones.map((o) => (
              <option key={o.id} value={o.id}>
                {o.nombre}
                {o.esCliente ? " · cliente de SIAC" : " · prospecto"}
              </option>
            ))}
          </select>
        </div>
        <button
          type="button"
          onClick={juntar}
          disabled={!elegida || pendiente}
          className="rounded-lg border border-red-200 bg-white px-4 py-2 text-sm font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50"
        >
          {pendiente ? "Juntando…" : "Juntar y borrar esta"}
        </button>
      </div>
      {error && <p className="text-sm text-red-700" role="alert">{error}</p>}
    </div>
  );
}
