"use client";

import { useActionState, useState } from "react";
import { CIERRES, ETAPAS_NEGOCIO, estaAbierto, type EtapaNegocio } from "@/lib/clientes/negocios";
import { enviarSinBorrar } from "../../cobranza/enviarSinBorrar";
import { cambiarEtapaAction, editarNegocioAction, type NegocioResult } from "../actions";

const campo = "w-full rounded-lg border border-black/10 bg-white px-3 py-2 text-sm";
const boton = "rounded-lg bg-finbra-purple px-4 py-2 text-sm font-semibold text-white hover:bg-finbra-purple/90 disabled:opacity-50";

function Aviso({ r }: { r: NegocioResult | null }) {
  if (!r) return null;
  return r.ok ? (
    <p className="text-sm text-emerald-700" role="status">{r.mensaje}</p>
  ) : (
    <p className="text-sm text-red-700" role="alert">{r.error}</p>
  );
}

const ORDEN = new Map(ETAPAS_NEGOCIO.map((e, i) => [e.value, i]));

/** Mover el negocio a otra etapa. Posponer, rechazar y regresar piden motivo. */
export function MoverEtapa({ id, etapa }: { id: string; etapa: EtapaNegocio }) {
  const [r, accion, guardando] = useActionState(cambiarEtapaAction.bind(null, id), null);
  const siguiente = ETAPAS_NEGOCIO.find((e, i) => estaAbierto(etapa) && i === (ORDEN.get(etapa) ?? 0) + 1)?.value;
  const [nueva, setNueva] = useState<string>(siguiente ?? "");
  // Al moverse el negocio, la etapa propuesta vuelve a ser la siguiente de la nueva.
  const [motivo, setMotivo] = useState("");
  const [deEtapa, setDeEtapa] = useState(etapa);
  if (deEtapa !== etapa) {
    setDeEtapa(etapa);
    setNueva(siguiente ?? "");
    setMotivo("");
  }
  const pideMotivo =
    CIERRES.includes(nueva as EtapaNegocio) || (estaAbierto(etapa) && estaAbierto(nueva as EtapaNegocio) && (ORDEN.get(nueva as EtapaNegocio) ?? 0) < (ORDEN.get(etapa) ?? 0));

  if (etapa === "dispersado") return <p className="text-sm text-finbra-gray">El crédito ya está dispersado; el negocio no cambia de etapa.</p>;
  return (
    // Sin limpiar el formulario al enviar: si hay un error, se conserva lo escrito.
    <form onSubmit={enviarSinBorrar(accion)} className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-48 flex-1 space-y-1">
          <label htmlFor="etapa" className="block text-sm font-medium">Mover a</label>
          <select id="etapa" name="etapa" required value={nueva} onChange={(e) => setNueva(e.target.value)} className={campo}>
            <option value="" disabled>Elige la etapa</option>
            {ETAPAS_NEGOCIO.filter((e) => e.value !== etapa).map((e) => (
              <option key={e.value} value={e.value}>
                {e.label}
                {e.value === siguiente ? " (siguiente)" : ""}
              </option>
            ))}
          </select>
        </div>
        <button type="submit" disabled={guardando || !nueva} className={boton}>
          {guardando ? "Moviendo…" : "Mover"}
        </button>
      </div>
      {nueva && (
        <div className="space-y-1">
          <label htmlFor="motivo" className="block text-sm font-medium">
            {nueva === "pospuesto" ? "Por qué se pospone" : nueva === "rechazado" ? "Por qué se rechaza" : "Motivo"}
            {!pideMotivo && <span className="font-normal text-finbra-gray"> (opcional)</span>}
          </label>
          <textarea id="motivo" name="motivo" rows={2} maxLength={1000} required={pideMotivo} value={motivo} onChange={(e) => setMotivo(e.target.value)} className={campo} />
        </div>
      )}
      <Aviso r={r} />
    </form>
  );
}

/** Monto estimado, responsable y notas. */
export function EditarNegocio({
  id,
  monto,
  responsable,
  notas,
  ejecutivos,
}: {
  id: string;
  monto: number | null;
  responsable: string | null;
  notas: string | null;
  ejecutivos: { email: string; nombre: string }[];
}) {
  const [r, accion, guardando] = useActionState(editarNegocioAction.bind(null, id), null);
  return (
    <form onSubmit={enviarSinBorrar(accion)} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <label htmlFor="montoEstimado" className="block text-sm font-medium">Monto estimado</label>
          <input id="montoEstimado" name="montoEstimado" inputMode="decimal" defaultValue={monto !== null ? monto.toLocaleString("es-MX") : ""} className={`${campo} tabular-nums`} />
        </div>
        <div className="space-y-1">
          <label htmlFor="responsableEmail" className="block text-sm font-medium">Responsable</label>
          <select id="responsableEmail" name="responsableEmail" defaultValue={responsable ?? ""} className={campo}>
            <option value="">Sin responsable</option>
            {ejecutivos.map((u) => (
              <option key={u.email} value={u.email}>{u.nombre}</option>
            ))}
          </select>
        </div>
      </div>
      <div className="space-y-1">
        <label htmlFor="notas" className="block text-sm font-medium">Notas</label>
        <textarea id="notas" name="notas" rows={3} maxLength={4000} defaultValue={notas ?? ""} className={campo} />
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={guardando} className={boton}>{guardando ? "Guardando…" : "Guardar"}</button>
        <Aviso r={r} />
      </div>
    </form>
  );
}
