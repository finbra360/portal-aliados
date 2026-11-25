"use client";

import { useActionState, useState } from "react";
import {
  CIERRES,
  DESTINOS,
  ETAPAS_NEGOCIO,
  ETIQUETA_ETAPA,
  GARANTIAS,
  MOTIVOS_RECHAZO,
  PRODUCTOS,
  estaAbierto,
  faltantesPara,
  listaLegible,
  type DatosSolicitud,
  type EtapaNegocio,
  type ParaRequisitos,
} from "@/lib/clientes/negocios";
import { enviarSinBorrar } from "../../cobranza/enviarSinBorrar";
import { cambiarBrokerAction, cambiarEtapaAction, editarNegocioAction, guardarMensajeBrokerAction, guardarSolicitudAction, type NegocioResult } from "../actions";

const campo = "w-full rounded-lg border border-black/10 bg-white px-3 py-2 text-sm";
const etiqueta = "block text-sm font-medium";
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

/** En qué tarjeta de la ficha se captura cada cosa que falta (faltantesPara). */
function dondeSeCaptura(falta: string): string {
  if (falta === "RFC de la empresa") return "los datos de la empresa";
  if (falta === "resultado de buró" || falta === "capacidad de pago") return "«Análisis»";
  if (falta.startsWith("la oferta") || falta.startsWith("que el cliente")) return "«Oferta»";
  if (falta.startsWith("la liga") || falta.includes("documento")) return "«Expediente»";
  if (falta.startsWith("la aprobación")) return "«Comité»";
  return "«Solicitud»";
}
const mananaDe = (hoy: string) => new Date(Date.parse(`${hoy}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10);

/**
 * Mover el negocio a otra etapa. Al posponer pide motivo y fecha para volver a
 * contactarlo; al rechazar, el motivo del catálogo; al regresar, el motivo. Al
 * avanzar avisa qué datos de la solicitud faltan (el servidor no lo deja pasar).
 */
export function MoverEtapa({ id, etapa, requisitos, hoy }: { id: string; etapa: EtapaNegocio; requisitos: ParaRequisitos; hoy: string }) {
  const [r, accion, guardando] = useActionState(cambiarEtapaAction.bind(null, id), null);
  const siguienteDe = (e: EtapaNegocio) => (estaAbierto(e) ? ETAPAS_NEGOCIO[(ORDEN.get(e) ?? 0) + 1]?.value : undefined);
  const [nueva, setNueva] = useState<string>(siguienteDe(etapa) ?? "");
  const [motivo, setMotivo] = useState("");
  // Al moverse el negocio, la etapa propuesta vuelve a ser la siguiente de la nueva.
  const [deEtapa, setDeEtapa] = useState(etapa);
  if (deEtapa !== etapa) {
    setDeEtapa(etapa);
    setNueva(siguienteDe(etapa) ?? "");
    setMotivo("");
  }

  if (etapa === "dispersado") return <p className="text-sm text-finbra-gray">El crédito ya está dispersado; el negocio no cambia de etapa.</p>;
  const destino = nueva as EtapaNegocio;
  const regresa = !!nueva && estaAbierto(etapa) && estaAbierto(destino) && (ORDEN.get(destino) ?? 0) < (ORDEN.get(etapa) ?? 0);
  const faltan = nueva && !regresa && !CIERRES.includes(destino) ? faltantesPara(destino, requisitos, etapa) : [];
  const donde = [...new Set(faltan.map(dondeSeCaptura))];
  const siguiente = siguienteDe(etapa);

  return (
    <form onSubmit={enviarSinBorrar(accion)} className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-48 flex-1 space-y-1">
          <label htmlFor="etapa" className={etiqueta}>Mover a</label>
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
        <button type="submit" disabled={guardando || !nueva || faltan.length > 0} className={boton}>
          {guardando ? "Moviendo…" : "Mover"}
        </button>
      </div>

      {faltan.length > 0 && (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
          Para pasar a {ETIQUETA_ETAPA[destino]} falta: {listaLegible(faltan)}. Se captura en {listaLegible(donde)}.
        </p>
      )}

      {nueva === "pospuesto" && (
        <div className="space-y-1">
          <label htmlFor="recontactarEl" className={etiqueta}>Volver a contactarlo el</label>
          <input id="recontactarEl" name="recontactarEl" type="date" required min={mananaDe(hoy)} className={`${campo} sm:w-56`} />
          <p className="text-xs text-finbra-gray">Queda una tarea para el responsable en esa fecha.</p>
        </div>
      )}
      {nueva === "rechazado" && (
        <div className="space-y-1">
          <label htmlFor="motivoRechazo" className={etiqueta}>Motivo del rechazo</label>
          <select id="motivoRechazo" name="motivoRechazo" required defaultValue="" className={campo}>
            <option value="" disabled>Elige el motivo</option>
            <optgroup label="Finbra no lo aprobó">
              {Object.entries(MOTIVOS_RECHAZO)
                .filter(([k, m]) => m.por === "finbra" && k !== "comite")
                .map(([k, m]) => (
                  <option key={k} value={k}>{m.label}</option>
                ))}
            </optgroup>
            <optgroup label="El cliente desistió">
              {Object.entries(MOTIVOS_RECHAZO)
                .filter(([, m]) => m.por === "cliente")
                .map(([k, m]) => (
                  <option key={k} value={k}>{m.label}</option>
                ))}
            </optgroup>
          </select>
        </div>
      )}
      {nueva && (
        <div className="space-y-1">
          <label htmlFor="motivo" className={etiqueta}>
            {nueva === "pospuesto" ? "Por qué se pospone" : nueva === "rechazado" ? "Detalle" : "Motivo"}
            {nueva !== "pospuesto" && !regresa && <span className="font-normal text-finbra-gray"> (opcional)</span>}
          </label>
          <textarea
            id="motivo"
            name="motivo"
            rows={2}
            maxLength={1000}
            required={nueva === "pospuesto" || regresa}
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            className={campo}
          />
        </div>
      )}
      <Aviso r={r} />
    </form>
  );
}

/**
 * Producto, monto, plazo, destino y garantía. La comisión por apertura va aquí
 * solo mientras la base no tenga la fase O5; después se captura en la oferta.
 */
export function Solicitud({ id, s, conComision }: { id: string; s: DatosSolicitud; conComision: boolean }) {
  const [r, accion, guardando] = useActionState(guardarSolicitudAction.bind(null, id), null);
  const [garantia, setGarantia] = useState<string>(s.garantiaTipo ?? "");
  const pesos = (n: number | null) => (n !== null ? n.toLocaleString("es-MX") : "");
  return (
    <form onSubmit={enviarSinBorrar(accion)} className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="space-y-1">
          <label htmlFor="producto" className={etiqueta}>Producto</label>
          <select id="producto" name="producto" defaultValue={s.producto ?? ""} className={campo}>
            <option value="">Sin definir</option>
            {Object.entries(PRODUCTOS).map(([v, t]) => (
              <option key={v} value={v}>{t}</option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <label htmlFor="montoEstimado" className={etiqueta}>Monto</label>
          <input id="montoEstimado" name="montoEstimado" inputMode="decimal" defaultValue={pesos(s.montoEstimado)} placeholder="1,500,000" className={`${campo} tabular-nums`} />
        </div>
        <div className="space-y-1">
          <label htmlFor="plazoMeses" className={etiqueta}>Plazo (meses)</label>
          <input id="plazoMeses" name="plazoMeses" type="number" min={1} max={120} step={1} defaultValue={s.plazoMeses ?? ""} className={`${campo} tabular-nums`} />
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <label htmlFor="destino" className={etiqueta}>Destino del crédito</label>
          <select id="destino" name="destino" defaultValue={s.destino ?? ""} className={campo}>
            <option value="">Sin definir</option>
            {Object.entries(DESTINOS).map(([v, t]) => (
              <option key={v} value={v}>{t}</option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <label htmlFor="destinoDetalle" className={etiqueta}>Detalle del destino <span className="font-normal text-finbra-gray">(opcional)</span></label>
          <input id="destinoDetalle" name="destinoDetalle" maxLength={500} defaultValue={s.destinoDetalle ?? ""} className={campo} />
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="space-y-1">
          <label htmlFor="garantiaTipo" className={etiqueta}>Garantía</label>
          <select id="garantiaTipo" name="garantiaTipo" value={garantia} onChange={(e) => setGarantia(e.target.value)} className={campo}>
            <option value="">Sin definir</option>
            {Object.entries(GARANTIAS).map(([v, t]) => (
              <option key={v} value={v}>{t}</option>
            ))}
          </select>
        </div>
        {garantia !== "sin_garantia" && (
          <>
            <div className="space-y-1">
              <label htmlFor="garantiaDetalle" className={etiqueta}>Qué es <span className="font-normal text-finbra-gray">(opcional)</span></label>
              <input id="garantiaDetalle" name="garantiaDetalle" maxLength={500} defaultValue={s.garantiaDetalle ?? ""} placeholder="3 tractocamiones 2021" className={campo} />
            </div>
            <div className="space-y-1">
              <label htmlFor="garantiaValor" className={etiqueta}>Valor estimado <span className="font-normal text-finbra-gray">(opcional)</span></label>
              <input id="garantiaValor" name="garantiaValor" inputMode="decimal" defaultValue={pesos(s.garantiaValor)} className={`${campo} tabular-nums`} />
            </div>
          </>
        )}
      </div>
      {conComision && (
      <div className="space-y-1 sm:w-1/3">
        <label htmlFor="comisionAperturaPct" className={etiqueta}>Comisión por apertura (%) <span className="font-normal text-finbra-gray">(opcional)</span></label>
        <input
          id="comisionAperturaPct"
          name="comisionAperturaPct"
          inputMode="decimal"
          defaultValue={s.comisionAperturaPct ?? ""}
          placeholder="4.5"
          className={`${campo} tabular-nums`}
        />
        <p className="text-xs text-finbra-gray">En negocios de broker define su comisión al dispersar.</p>
      </div>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={guardando} className={boton}>{guardando ? "Guardando…" : "Guardar solicitud"}</button>
        <Aviso r={r} />
      </div>
    </form>
  );
}

/** Responsable y notas. */
export function EditarNegocio({ id, responsable, notas, ejecutivos }: { id: string; responsable: string | null; notas: string | null; ejecutivos: { email: string; nombre: string }[] }) {
  const [r, accion, guardando] = useActionState(editarNegocioAction.bind(null, id), null);
  return (
    <form onSubmit={enviarSinBorrar(accion)} className="space-y-3">
      <div className="space-y-1">
        <label htmlFor="responsableEmail" className={etiqueta}>Responsable</label>
        <select id="responsableEmail" name="responsableEmail" defaultValue={responsable ?? ""} className={`${campo} sm:w-72`}>
          <option value="">Sin responsable</option>
          {ejecutivos.map((u) => (
            <option key={u.email} value={u.email}>{u.nombre}</option>
          ))}
        </select>
      </div>
      <div className="space-y-1">
        <label htmlFor="notas" className={etiqueta}>Notas</label>
        <textarea id="notas" name="notas" rows={3} maxLength={4000} defaultValue={notas ?? ""} className={campo} />
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={guardando} className={boton}>{guardando ? "Guardando…" : "Guardar"}</button>
        <Aviso r={r} />
      </div>
    </form>
  );
}

/** De qué broker viene el negocio y lo que el broker ve en su portal. */
export function BrokerDelNegocio({
  id,
  brokerId,
  mensaje,
  brokers,
  conColocacion,
}: {
  id: string;
  brokerId: string | null;
  mensaje: string | null;
  brokers: { id: string; nombre: string }[];
  conColocacion: boolean;
}) {
  const [rb, accionBroker, guardandoBroker] = useActionState(cambiarBrokerAction.bind(null, id), null);
  const [rm, accionMensaje, guardandoMensaje] = useActionState(guardarMensajeBrokerAction.bind(null, id), null);
  return (
    <div className="space-y-4">
      <form onSubmit={enviarSinBorrar(accionBroker)} className="flex flex-wrap items-end gap-3">
        <div className="min-w-48 flex-1 space-y-1">
          <label htmlFor="brokerId" className={etiqueta}>Broker</label>
          <select id="brokerId" name="brokerId" defaultValue={brokerId ?? ""} disabled={conColocacion} className={campo}>
            <option value="">Sin broker</option>
            {brokers.map((b) => (
              <option key={b.id} value={b.id}>{b.nombre} · {b.id}</option>
            ))}
          </select>
        </div>
        {!conColocacion && (
          <button type="submit" disabled={guardandoBroker} className={boton}>{guardandoBroker ? "Guardando…" : "Guardar"}</button>
        )}
        <div className="w-full"><Aviso r={rb} /></div>
      </form>
      {brokerId && (
        <form onSubmit={enviarSinBorrar(accionMensaje)} className="space-y-2">
          <label htmlFor="mensajeBroker" className={etiqueta}>Mensaje para el broker</label>
          <textarea id="mensajeBroker" name="mensajeBroker" rows={2} maxLength={1000} defaultValue={mensaje ?? ""} className={campo} />
          <p className="text-xs text-finbra-gray">Lo ve en su portal, en el seguimiento de esta solicitud. Las notas internas no se le muestran.</p>
          <div className="flex flex-wrap items-center gap-3">
            <button type="submit" disabled={guardandoMensaje} className={boton}>{guardandoMensaje ? "Guardando…" : "Guardar mensaje"}</button>
            <Aviso r={rm} />
          </div>
        </form>
      )}
    </div>
  );
}
