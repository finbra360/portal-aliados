"use client";

import { useActionState, useState, useTransition } from "react";
import { enviarSinBorrar } from "../enviarSinBorrar";
import {
  crearPlantillasAction,
  enviarAhoraAction,
  enviarPruebaAction,
  revisarConMetaAction,
  setEnvioActivoAction,
  setPlantillaActivaAction,
  type WhatsAppActionResult,
} from "./actions";
import { enviarPreventivosAhoraAction, obtenerMontosAction, setPreventivoActivoAction } from "../preventivos/actions";

type Tipo = "mora" | "preventivo";

const TEXTO: Record<Tipo, { prender: string; enviar: (n: number) => string }> = {
  mora: {
    prender: "¿Prender el envío automático? A partir de la siguiente corrida de las 9:00, los clientes en mora recibirán un WhatsApp al día.",
    enviar: (n) => `¿Enviar ahora ${n === 1 ? "1 recordatorio" : `${n} recordatorios`} de mora por WhatsApp?`,
  },
  preventivo: {
    prender: "¿Prender el envío automático de preventivos? A partir de la siguiente corrida de las 9:00, los clientes recibirán sus recordatorios 5 días antes, 1 día antes y el día del pago.",
    enviar: (n) => `¿Enviar ahora ${n === 1 ? "1 recordatorio preventivo" : `${n} recordatorios preventivos`} por WhatsApp?`,
  },
};

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

export function EnvioToggle({ activo, puedeEditar, tipo = "mora" }: { activo: boolean; puedeEditar: boolean; tipo?: Tipo }) {
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
              if (activo || window.confirm(TEXTO[tipo].prender)) {
                correr(() => (tipo === "mora" ? setEnvioActivoAction(!activo) : setPreventivoActivoAction(!activo)));
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

export function PlantillaToggle({ id, activa, puedeEditar, noActivable }: { id: number; activa: boolean; puedeEditar: boolean; noActivable: string | null }) {
  const { pending, correr, aviso } = useAccion();
  if (!puedeEditar) return <span className="text-sm">{activa ? "Activa" : "Inactiva"}</span>;
  return (
    <span className="flex flex-col items-end gap-1">
      <label className="flex items-center gap-2 text-sm" title={!activa && noActivable ? noActivable : undefined}>
        <input
          type="checkbox"
          checked={activa}
          disabled={pending || (!activa && noActivable !== null)}
          onChange={(e) => correr(() => setPlantillaActivaAction(id, e.target.checked))}
        />
        {activa ? "Activa" : "Inactiva"}
      </label>
      {aviso}
    </span>
  );
}

export function RevisarConMeta() {
  const { pending, correr, aviso } = useAccion();
  return (
    <div className="space-y-2">
      <button
        type="button"
        disabled={pending}
        onClick={() => correr(revisarConMetaAction)}
        className="rounded-lg bg-finbra-purple px-4 py-2 text-sm font-semibold text-white hover:bg-finbra-purple/90 disabled:opacity-50"
      >
        {pending ? "Revisando…" : "Revisar con Meta"}
      </button>
      {aviso}
    </div>
  );
}

export function EnviarPrueba({ plantillas }: { plantillas: { id: number; nombre: string }[] }) {
  const [state, accion, enviando] = useActionState(enviarPruebaAction, null);
  if (plantillas.length === 0) {
    return <p className="text-sm text-finbra-gray">Se habilita cuando Meta apruebe al menos una plantilla de mora (usa "Revisar con Meta" para actualizar).</p>;
  }
  const input = "w-full rounded-lg border border-black/10 bg-white px-3 py-1.5 text-sm";
  return (
    <form onSubmit={enviarSinBorrar(accion)} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="space-y-1 text-sm">
          <span className="text-finbra-gray">Tu número (10 dígitos)</span>
          <input name="telefono" required inputMode="tel" autoComplete="off" placeholder="55 1234 5678" className={input} />
        </label>
        <label className="space-y-1 text-sm">
          <span className="text-finbra-gray">Plantilla</span>
          <select name="plantillaId" className={input}>
            {plantillas.map((t) => (
              <option key={t.id} value={t.id}>{t.nombre}</option>
            ))}
          </select>
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={enviando} className="rounded-lg border border-finbra-purple px-4 py-2 text-sm font-semibold text-finbra-purple-700 hover:bg-finbra-purple/5 disabled:opacity-40">
          {enviando ? "Enviando…" : "Enviar prueba"}
        </button>
      </div>
      {state &&
        (state.ok ? (
          <p className="text-sm text-emerald-700" role="status">{state.mensaje}</p>
        ) : (
          <p className="text-sm text-red-700" role="alert">{state.error}</p>
        ))}
    </form>
  );
}

export function EnviarAhora({ disponible, cuantos, tipo = "mora" }: { disponible: boolean; cuantos: number; tipo?: Tipo }) {
  const { pending, correr, aviso } = useAccion();
  return (
    <div className="space-y-2">
      <button
        type="button"
        disabled={pending || !disponible || cuantos === 0}
        onClick={() => {
          if (window.confirm(TEXTO[tipo].enviar(cuantos))) correr(tipo === "mora" ? enviarAhoraAction : enviarPreventivosAhoraAction);
        }}
        className="rounded-lg border border-finbra-purple px-4 py-2 text-sm font-semibold text-finbra-purple-700 hover:bg-finbra-purple/5 disabled:opacity-40"
      >
        {pending ? "Enviando…" : "Enviar ahora"}
      </button>
      {aviso}
    </div>
  );
}

export function CrearPlantillas({ faltan }: { faltan: string[] }) {
  const { pending, correr, aviso } = useAccion();
  return (
    <div className="space-y-2">
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          if (window.confirm(`¿Dar de alta en Meta y mandar a revisión: ${faltan.join(", ")}? Se crean como Utilidad, en español de México, con los textos de abajo.`)) correr(crearPlantillasAction);
        }}
        className="rounded-lg bg-finbra-purple px-4 py-2 text-sm font-semibold text-white hover:bg-finbra-purple/90 disabled:opacity-50"
      >
        {pending ? "Creando…" : "Crear plantillas en Meta"}
      </button>
      {aviso}
    </div>
  );
}

/** Preventivos: pregunta a SIAC el monto de la mensualidad de los que hoy reciben recordatorio. */
export function ConsultarMontos({ cuantos }: { cuantos: number }) {
  const { pending, correr, aviso } = useAccion();
  return (
    <div className="space-y-2">
      <button
        type="button"
        disabled={pending || cuantos === 0}
        onClick={() => {
          if (window.confirm(`¿Consultar a SIAC el monto de ${cuantos === 1 ? "1 crédito" : `${cuantos} créditos`}? Es una consulta por crédito (ConsultarSaldoCredito a su fecha de vencimiento).`)) correr(obtenerMontosAction);
        }}
        className="rounded-lg border border-finbra-purple px-4 py-2 text-sm font-semibold text-finbra-purple-700 hover:bg-finbra-purple/5 disabled:opacity-40"
      >
        {pending ? "Consultando…" : cuantos === 1 ? "Consultar 1 monto a SIAC" : `Consultar ${cuantos} montos a SIAC`}
      </button>
      {aviso}
    </div>
  );
}
