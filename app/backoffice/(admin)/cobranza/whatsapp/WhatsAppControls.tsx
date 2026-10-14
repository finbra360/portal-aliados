"use client";

import { useState, useTransition } from "react";
import { enviarAhoraAction, setEnvioActivoAction, setPlantillaActivaAction, type WhatsAppActionResult } from "./actions";

function useAccion() {
  const [pending, start] = useTransition();
  const [resultado, setResultado] = useState<WhatsAppActionResult | null>(null);
  const correr = (fn: () => Promise<WhatsAppActionResult>) =>
    start(async () => {
      setResultado(null);
      setResultado(await fn());
    });
  const aviso = resultado ? (
    resultado.ok ? (
      resultado.mensaje ? <p className="text-sm text-emerald-700" role="status">{resultado.mensaje}</p> : null
    ) : (
      <p className="text-sm text-red-700" role="alert">{resultado.error}</p>
    )
  ) : null;
  return { pending, correr, aviso };
}

export function EnvioToggle({ activo, puedeEditar }: { activo: boolean; puedeEditar: boolean }) {
  const { pending, correr, aviso } = useAccion();
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-3">
        <span className={`rounded-full px-3 py-1 text-sm font-semibold ${activo ? "bg-emerald-100 text-emerald-700" : "bg-black/5 text-finbra-gray"}`}>
          Envío automático {activo ? "encendido" : "apagado"}
        </span>
        {puedeEditar && (
          <button
            type="button"
            disabled={pending}
            onClick={() => {
              if (activo || window.confirm("¿Prender el envío automático? A partir de la siguiente corrida de las 9:00, los clientes en mora recibirán un WhatsApp al día.")) {
                correr(() => setEnvioActivoAction(!activo));
              }
            }}
            className="rounded-lg bg-finbra-purple px-4 py-2 text-sm font-semibold text-white hover:bg-finbra-purple/90 disabled:opacity-50"
          >
            {activo ? "Apagar" : "Prender"}
          </button>
        )}
      </div>
      {aviso}
    </div>
  );
}

export function PlantillaToggle({ id, activa, puedeEditar }: { id: number; activa: boolean; puedeEditar: boolean }) {
  const { pending, correr, aviso } = useAccion();
  if (!puedeEditar) return <span className="text-sm">{activa ? "Activa" : "Inactiva"}</span>;
  return (
    <span className="flex flex-col items-end gap-1">
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={activa} disabled={pending} onChange={(e) => correr(() => setPlantillaActivaAction(id, e.target.checked))} />
        {activa ? "Activa" : "Inactiva"}
      </label>
      {aviso}
    </span>
  );
}

export function EnviarAhora({ disponible, cuantos }: { disponible: boolean; cuantos: number }) {
  const { pending, correr, aviso } = useAccion();
  return (
    <div className="space-y-2">
      <button
        type="button"
        disabled={pending || !disponible || cuantos === 0}
        onClick={() => {
          if (window.confirm(`¿Enviar ahora ${cuantos === 1 ? "1 recordatorio" : `${cuantos} recordatorios`} de mora por WhatsApp?`)) correr(enviarAhoraAction);
        }}
        className="rounded-lg border border-finbra-purple px-4 py-2 text-sm font-semibold text-finbra-purple hover:bg-finbra-purple/5 disabled:opacity-40"
      >
        {pending ? "Enviando…" : "Enviar ahora"}
      </button>
      {aviso}
    </div>
  );
}
