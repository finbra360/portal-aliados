"use client";

// Formularios de la fase O5: análisis (quien analiza crédito), oferta y
// expediente (quien opera originación) y decisión de comité (quien decide).

import { useActionState, useState } from "react";
import {
  DECISIONES,
  ESTADOS_DOCUMENTO,
  RESPUESTAS_OFERTA,
  RESULTADOS_BURO,
  type DatosAnalisis,
  type DatosOferta,
  type DocumentoExpediente,
} from "@/lib/clientes/comite";
import { enviarSinBorrar } from "../../cobranza/enviarSinBorrar";
import { guardarAnalisisAction, guardarExpedienteAction, guardarOfertaAction, registrarDecisionAction, type NegocioResult } from "../actions";

const campo = "w-full rounded-lg border border-black/10 bg-white px-3 py-2 text-sm";
const etiqueta = "block text-sm font-medium";
const boton = "rounded-lg bg-finbra-purple px-4 py-2 text-sm font-semibold text-white hover:bg-finbra-purple/90 disabled:opacity-50";
const opcional = <span className="font-normal text-finbra-gray">(opcional)</span>;
const pesos = (n: number | null) => (n !== null ? n.toLocaleString("es-MX") : "");

function Aviso({ r }: { r: NegocioResult | null }) {
  if (!r) return null;
  return r.ok ? (
    <p className="text-sm text-emerald-700" role="status">{r.mensaje}</p>
  ) : (
    <p className="text-sm text-red-700" role="alert">{r.error}</p>
  );
}

/** Resultado de buró, capacidad de pago y notas. */
export function Analisis({ id, a }: { id: string; a: DatosAnalisis }) {
  const [r, accion, guardando] = useActionState(guardarAnalisisAction.bind(null, id), null);
  return (
    <form onSubmit={enviarSinBorrar(accion)} className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <label htmlFor="buroResultado" className={etiqueta}>Resultado de buró</label>
          <select id="buroResultado" name="buroResultado" defaultValue={a.buroResultado ?? ""} className={campo}>
            <option value="">Sin capturar</option>
            {Object.entries(RESULTADOS_BURO).map(([v, t]) => (
              <option key={v} value={v}>{t}</option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <label htmlFor="capacidadPagoMensual" className={etiqueta}>Capacidad de pago mensual</label>
          <input
            id="capacidadPagoMensual"
            name="capacidadPagoMensual"
            inputMode="decimal"
            defaultValue={pesos(a.capacidadPagoMensual)}
            placeholder="85,000"
            className={`${campo} tabular-nums`}
          />
        </div>
      </div>
      <div className="space-y-1">
        <label htmlFor="analisisNotas" className={etiqueta}>Notas del análisis {opcional}</label>
        <textarea id="analisisNotas" name="notas" rows={3} maxLength={4000} defaultValue={a.notas ?? ""} placeholder="Visita, flujo, DSCR, observaciones de buró…" className={campo} />
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={guardando} className={boton}>{guardando ? "Guardando…" : "Guardar análisis"}</button>
        <Aviso r={r} />
      </div>
    </form>
  );
}

/** Monto, tasa, plazo y comisión ofrecidos, y si el cliente aceptó. */
export function Oferta({ id, o, conBroker, conColocacion }: { id: string; o: DatosOferta; conBroker: boolean; conColocacion: boolean }) {
  const [r, accion, guardando] = useActionState(guardarOfertaAction.bind(null, id), null);
  return (
    <form onSubmit={enviarSinBorrar(accion)} className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="space-y-1">
          <label htmlFor="ofertaMonto" className={etiqueta}>Monto</label>
          <input id="ofertaMonto" name="monto" inputMode="decimal" defaultValue={pesos(o.monto)} placeholder="1,500,000" className={`${campo} tabular-nums`} />
        </div>
        <div className="space-y-1">
          <label htmlFor="ofertaTasa" className={etiqueta}>Tasa anual (%)</label>
          <input id="ofertaTasa" name="tasaAnual" inputMode="decimal" defaultValue={o.tasaAnual ?? ""} placeholder="24.5" className={`${campo} tabular-nums`} />
        </div>
        <div className="space-y-1">
          <label htmlFor="ofertaPlazo" className={etiqueta}>Plazo (meses)</label>
          <input id="ofertaPlazo" name="plazoMeses" type="number" min={1} max={120} step={1} defaultValue={o.plazoMeses ?? ""} className={`${campo} tabular-nums`} />
        </div>
        <div className="space-y-1">
          <label htmlFor="ofertaComision" className={etiqueta}>Comisión por apertura (%)</label>
          <input
            id="ofertaComision"
            name="comisionAperturaPct"
            inputMode="decimal"
            defaultValue={o.comisionAperturaPct ?? ""}
            placeholder="4.5"
            disabled={conColocacion}
            className={`${campo} tabular-nums`}
          />
        </div>
      </div>
      {conColocacion ? (
        <input type="hidden" name="comisionAperturaPct" value={o.comisionAperturaPct ?? ""} />
      ) : (
        conBroker && <p className="text-xs text-finbra-gray">La comisión del broker sale de este % al dispersar (la tabla de comisiones reconoce 3.5, 4, 4.5 y 5 %).</p>
      )}
      <div className="space-y-1 sm:w-1/2">
        <label htmlFor="ofertaRespuesta" className={etiqueta}>Respuesta del cliente</label>
        <select id="ofertaRespuesta" name="respuesta" defaultValue={o.respuesta ?? ""} className={campo}>
          <option value="">Todavía no responde</option>
          {Object.entries(RESPUESTAS_OFERTA).map(([v, t]) => (
            <option key={v} value={v}>{t}</option>
          ))}
        </select>
        <p className="text-xs text-finbra-gray">Si no la acepta y no hay contraoferta, cierra el negocio como rechazado (motivo del cliente).</p>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={guardando} className={boton}>{guardando ? "Guardando…" : "Guardar oferta"}</button>
        <Aviso r={r} />
      </div>
    </form>
  );
}

/** Liga a la carpeta y estado de cada documento de la lista del producto. */
export function Expediente({ id, url, documentos }: { id: string; url: string | null; documentos: (DocumentoExpediente & { actualizadoNombre: string | null })[] }) {
  const [r, accion, guardando] = useActionState(guardarExpedienteAction.bind(null, id), null);
  return (
    <form onSubmit={enviarSinBorrar(accion)} className="space-y-4">
      <div className="space-y-1">
        <label htmlFor="expedienteUrl" className={etiqueta}>Carpeta del expediente</label>
        <input id="expedienteUrl" name="expedienteUrl" type="url" maxLength={500} defaultValue={url ?? ""} placeholder="https://drive.google.com/drive/folders/…" className={campo} />
        {url && (
          <a href={url} target="_blank" rel="noopener noreferrer" className="text-xs text-finbra-purple hover:underline">
            Abrir la carpeta ↗
          </a>
        )}
      </div>
      {documentos.length === 0 ? (
        <p className="text-sm text-finbra-gray">Elige el producto en «Solicitud» para ver su lista de documentos.</p>
      ) : (
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">Documentos</legend>
          <ul className="divide-y divide-black/5 rounded-lg border border-black/5">
            {documentos.map((d) => (
              <li key={d.clave} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
                <div className="min-w-0 flex-1">
                  <label htmlFor={`doc_${d.clave}`}>{d.nombre}</label>
                  {d.actualizadoAt && (
                    <p className="text-xs text-finbra-gray">
                      {ESTADOS_DOCUMENTO[d.estado]} · {d.actualizadoNombre ?? d.actualizadoPor}
                    </p>
                  )}
                </div>
                <select
                  id={`doc_${d.clave}`}
                  name={`doc_${d.clave}`}
                  defaultValue={d.estado}
                  className={`rounded-lg border border-black/10 px-2 py-1 text-sm ${d.estado === "recibido" ? "bg-emerald-50" : d.estado === "no_aplica" ? "bg-black/5" : "bg-white"}`}
                >
                  {Object.entries(ESTADOS_DOCUMENTO).map(([v, t]) => (
                    <option key={v} value={v}>{t}</option>
                  ))}
                </select>
              </li>
            ))}
          </ul>
        </fieldset>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={guardando} className={boton}>{guardando ? "Guardando…" : "Guardar expediente"}</button>
        <Aviso r={r} />
      </div>
    </form>
  );
}

/** Decisión del comité. Aprobado pasa a Formalización; rechazado cierra el negocio. */
export function DecisionComite({ id, oferta }: { id: string; oferta: DatosOferta }) {
  const [r, accion, guardando] = useActionState(registrarDecisionAction.bind(null, id), null);
  const [decision, setDecision] = useState<string>("");
  return (
    <form onSubmit={enviarSinBorrar(accion)} className="space-y-4">
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Decisión del comité">
        {Object.entries(DECISIONES).map(([v, t]) => (
          <label
            key={v}
            className={`cursor-pointer rounded-full px-4 py-1.5 text-sm font-medium ${
              decision === v ? (v === "aprobado" ? "bg-emerald-600 text-white" : "bg-red-600 text-white") : "bg-black/5 text-finbra-gray hover:bg-black/10"
            }`}
          >
            <input type="radio" name="decision" value={v} checked={decision === v} onChange={() => setDecision(v)} className="sr-only" />
            {t}
          </label>
        ))}
      </div>
      {decision === "aprobado" && (
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-1">
            <label htmlFor="decMonto" className={etiqueta}>Monto aprobado</label>
            <input id="decMonto" name="monto" required inputMode="decimal" defaultValue={pesos(oferta.monto)} className={`${campo} tabular-nums`} />
          </div>
          <div className="space-y-1">
            <label htmlFor="decTasa" className={etiqueta}>Tasa anual (%)</label>
            <input id="decTasa" name="tasaAnual" required inputMode="decimal" defaultValue={oferta.tasaAnual ?? ""} className={`${campo} tabular-nums`} />
          </div>
          <div className="space-y-1">
            <label htmlFor="decPlazo" className={etiqueta}>Plazo (meses)</label>
            <input id="decPlazo" name="plazoMeses" required type="number" min={1} max={120} step={1} defaultValue={oferta.plazoMeses ?? ""} className={`${campo} tabular-nums`} />
          </div>
        </div>
      )}
      {decision && (
        <div className="space-y-1">
          <label htmlFor="condiciones" className={etiqueta}>
            {decision === "aprobado" ? <>Condiciones {opcional}</> : "Por qué lo rechaza el comité"}
          </label>
          <textarea
            id="condiciones"
            name="condiciones"
            rows={3}
            maxLength={2000}
            required={decision === "rechazado"}
            placeholder={decision === "aprobado" ? "Aval del socio mayoritario, GPS en las 3 unidades…" : ""}
            className={campo}
          />
        </div>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={guardando || !decision} className={boton}>
          {guardando ? "Registrando…" : decision === "rechazado" ? "Registrar rechazo" : "Registrar aprobación"}
        </button>
        <p className="text-xs text-finbra-gray">
          {decision === "rechazado" ? "El negocio se cierra como «Rechazado en comité»." : "El negocio pasa a Formalización."}
        </p>
      </div>
      <Aviso r={r} />
    </form>
  );
}
