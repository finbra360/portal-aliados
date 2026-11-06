"use client";

import { useState, useTransition } from "react";
import { enviarCorreoPruebaAction, enviarCorreosAhoraAction, setCorreoActivoAction, type CorreoActionResult } from "./actions";

type Tipo = "mora" | "preventivo";

const TEXTO: Record<Tipo, { prender: string; enviar: (n: number) => string }> = {
  mora: {
    prender: "¿Prender los correos de mora? A partir de la siguiente corrida de las 9:00 (lunes a viernes), los clientes en mora recibirán un correo al día.",
    enviar: (n) => `¿Enviar ahora ${n === 1 ? "1 correo" : `${n} correos`} de mora?`,
  },
  preventivo: {
    prender: "¿Prender los correos preventivos? A partir de la siguiente corrida de las 9:00 (lunes a viernes), los clientes recibirán su correo 5 días antes, 1 día antes y el día del pago.",
    enviar: (n) => `¿Enviar ahora ${n === 1 ? "1 correo preventivo" : `${n} correos preventivos`}?`,
  },
};

const boton = "rounded-lg bg-finbra-purple px-4 py-2 text-sm font-semibold text-white hover:bg-finbra-purple/90 disabled:opacity-50";
const botonSecundario = "rounded-lg border border-finbra-purple px-4 py-2 text-sm font-semibold text-finbra-purple-700 hover:bg-finbra-purple/5 disabled:opacity-40";

function useAccion() {
  const [pending, start] = useTransition();
  const [resultado, setResultado] = useState<CorreoActionResult | null>(null);
  const correr = (fn: () => Promise<CorreoActionResult>) =>
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

export function CorreoToggle({ tipo, activo, puedeEditar }: { tipo: Tipo; activo: boolean; puedeEditar: boolean }) {
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
              if (activo || window.confirm(TEXTO[tipo].prender)) correr(() => setCorreoActivoAction(tipo, !activo));
            }}
            className={boton}
          >
            {activo ? "Apagar" : "Prender"}
          </button>
        )}
      </div>
      {aviso}
    </div>
  );
}

export function EnviarCorreosAhora({ tipo, disponible, cuantos }: { tipo: Tipo; disponible: boolean; cuantos: number }) {
  const { pending, correr, aviso } = useAccion();
  return (
    <div className="space-y-2">
      <button
        type="button"
        disabled={pending || !disponible || cuantos === 0}
        onClick={() => {
          if (window.confirm(TEXTO[tipo].enviar(cuantos))) correr(() => enviarCorreosAhoraAction(tipo));
        }}
        className={botonSecundario}
      >
        {pending ? "Enviando…" : "Enviar ahora"}
      </button>
      {aviso}
    </div>
  );
}

export function CorreoPrueba({ correo }: { correo: string }) {
  const { pending, correr, aviso } = useAccion();
  return (
    <div className="space-y-2">
      <button type="button" disabled={pending} onClick={() => correr(enviarCorreoPruebaAction)} className={botonSecundario}>
        {pending ? "Enviando…" : `Enviar prueba a ${correo}`}
      </button>
      {aviso}
    </div>
  );
}
