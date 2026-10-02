"use client";

import { useActionState, useState, useTransition } from "react";
import { CANALES_PROMESA, MAX_DIAS_PAUSA, MAX_DIAS_PROMESA, RESULTADOS, TIPOS_GESTION } from "@/lib/collections/gestiones";
import { addDays } from "@/lib/collections/rules";
import { formatFecha, formatTelefono } from "@/lib/format";
import { crearPromesaAction, pausarAction, reanudarAction, registrarGestionAction, type ActionResult } from "./actions";

type Pestana = "gestion" | "promesa" | "pausa";

const input = "w-full rounded-lg border border-black/10 bg-white px-3 py-1.5 text-sm";
const boton = "rounded-lg bg-finbra-purple px-4 py-2 text-sm font-semibold text-white hover:bg-finbra-purple/90 disabled:opacity-50";

function Aviso({ state, ok }: { state: ActionResult | null; ok: string }) {
  if (!state) return null;
  return state.ok ? (
    <p className="text-sm text-emerald-700" role="status">{ok}</p>
  ) : (
    <p className="text-sm text-red-700" role="alert">{state.error}</p>
  );
}

function CamposPromesa({ hoy }: { hoy: string }) {
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <label className="space-y-1 text-sm">
        <span className="text-finbra-gray">Monto prometido</span>
        <input name="monto" inputMode="decimal" required placeholder="$ 20,000" className={input} />
      </label>
      <label className="space-y-1 text-sm">
        <span className="text-finbra-gray">Fecha en que paga</span>
        <input name="fecha" type="date" required min={hoy} max={addDays(hoy, MAX_DIAS_PROMESA)} className={input} />
      </label>
      <label className="space-y-1 text-sm">
        <span className="text-finbra-gray">Canal</span>
        <select name="canal" defaultValue="llamada" className={input}>
          {Object.entries(CANALES_PROMESA).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
      </label>
    </div>
  );
}

export default function GestionesPanel({
  clientId,
  hoy,
  telefonos,
  creditos,
  pausa,
}: {
  clientId: string;
  hoy: string;
  telefonos: { id: string; valor: string; nombre: string | null }[];
  creditos: { id: string; noCredito: string }[];
  pausa: { hasta: string | null; motivo: string | null };
}) {
  const [pestana, setPestana] = useState<Pestana>("gestion");
  const [tipo, setTipo] = useState("llamada");
  const [resultado, setResultado] = useState("");
  const [form, setForm] = useState(0); // para limpiar el formulario después de guardar

  const conResultado = tipo === "llamada" || tipo === "visita";
  const [gestion, accionGestion, guardandoGestion] = useActionState(async (prev: ActionResult | null, fd: FormData) => {
    const r = await registrarGestionAction(clientId, prev, fd);
    if (r.ok) {
      setResultado("");
      setForm((n) => n + 1);
    }
    return r;
  }, null);
  const [promesa, accionPromesa, guardandoPromesa] = useActionState(async (prev: ActionResult | null, fd: FormData) => {
    const r = await crearPromesaAction(clientId, prev, fd);
    if (r.ok) setForm((n) => n + 1);
    return r;
  }, null);
  const [pausaState, accionPausa, guardandoPausa] = useActionState(async (prev: ActionResult | null, fd: FormData) => pausarAction(clientId, prev, fd), null);
  const [reanudando, startReanudar] = useTransition();
  const [errorReanudar, setErrorReanudar] = useState<string | null>(null);

  const pausado = pausa.hasta !== null && pausa.hasta >= hoy;
  const PESTANAS: { value: Pestana; label: string }[] = [
    { value: "gestion", label: "Registrar gestión" },
    { value: "promesa", label: "Promesa de pago" },
    { value: "pausa", label: pausado ? "Pausada" : "Pausar cobranza" },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2" role="tablist">
        {PESTANAS.map((p) => (
          <button
            key={p.value}
            type="button"
            role="tab"
            aria-selected={pestana === p.value}
            onClick={() => setPestana(p.value)}
            className={`rounded-full px-4 py-1.5 text-sm font-medium ${pestana === p.value ? "bg-finbra-purple text-white" : "bg-black/5 text-finbra-gray hover:bg-black/10"}`}
          >
            {p.label}
          </button>
        ))}
      </div>

      {pestana === "gestion" && (
        <form key={`g${form}`} action={accionGestion} className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1 text-sm">
              <span className="text-finbra-gray">Qué fue</span>
              <select name="tipo" value={tipo} onChange={(e) => setTipo(e.target.value)} className={input}>
                {Object.entries(TIPOS_GESTION).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </select>
            </label>
            {conResultado && (
              <label className="space-y-1 text-sm">
                <span className="text-finbra-gray">Cómo terminó</span>
                <select name="resultado" value={resultado} onChange={(e) => setResultado(e.target.value)} required className={input}>
                  <option value="" disabled>Elige…</option>
                  {Object.entries(RESULTADOS).map(([k, v]) => (
                    <option key={k} value={k}>{v}</option>
                  ))}
                </select>
              </label>
            )}
            {telefonos.length > 0 && (tipo === "llamada" || tipo === "correo") && (
              <label className="space-y-1 text-sm">
                <span className="text-finbra-gray">Con quién (opcional)</span>
                <select name="contactId" defaultValue="" className={input}>
                  <option value="">Sin especificar</option>
                  {telefonos.map((t) => (
                    <option key={t.id} value={t.id}>{formatTelefono(t.valor)}{t.nombre ? ` · ${t.nombre}` : ""}</option>
                  ))}
                </select>
              </label>
            )}
            {creditos.length > 1 && (
              <label className="space-y-1 text-sm">
                <span className="text-finbra-gray">Crédito (opcional)</span>
                <select name="creditId" defaultValue="" className={input}>
                  <option value="">Todos los créditos</option>
                  {creditos.map((c) => (
                    <option key={c.id} value={c.id}>{c.noCredito}</option>
                  ))}
                </select>
              </label>
            )}
          </div>
          {resultado === "promesa" && conResultado && (
            <div className="rounded-lg bg-finbra-purple/5 p-3">
              <p className="mb-2 text-sm font-medium">La promesa se registra junto con la gestión</p>
              <CamposPromesa hoy={hoy} />
            </div>
          )}
          <label className="block space-y-1 text-sm">
            <span className="text-finbra-gray">{conResultado ? "Notas (opcional)" : "Qué pasó"}</span>
            <textarea name="descripcion" rows={3} maxLength={2000} required={!conResultado} placeholder="Ej. Dice que el pago de octubre se retrasa por un cliente suyo; vuelve a llamar el jueves." className={input} />
          </label>
          <div className="flex flex-wrap items-center gap-3">
            <button type="submit" disabled={guardandoGestion} className={boton}>{guardandoGestion ? "Guardando…" : "Guardar gestión"}</button>
            <Aviso state={gestion} ok="Gestión guardada en el historial." />
          </div>
        </form>
      )}

      {pestana === "promesa" && (
        <form key={`p${form}`} action={accionPromesa} className="space-y-3">
          <CamposPromesa hoy={hoy} />
          <div className="grid gap-3 sm:grid-cols-2">
            {creditos.length > 1 && (
              <label className="space-y-1 text-sm">
                <span className="text-finbra-gray">Crédito</span>
                <select name="creditId" defaultValue="" className={input}>
                  <option value="">Todo el cliente</option>
                  {creditos.map((c) => (
                    <option key={c.id} value={c.id}>{c.noCredito}</option>
                  ))}
                </select>
              </label>
            )}
            <label className="space-y-1 text-sm">
              <span className="text-finbra-gray">Notas (opcional)</span>
              <input name="notas" placeholder="Ej. Paga con transferencia de su cliente X" className={input} />
            </label>
          </div>
          <p className="text-xs text-finbra-gray">
            Un cliente tiene una sola promesa vigente: si ya tenía una, se cancela y queda registrado. El sistema la marca cumplida o incumplida con los pagos de SIAC, con un día de gracia.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <button type="submit" disabled={guardandoPromesa} className={boton}>{guardandoPromesa ? "Guardando…" : "Guardar promesa"}</button>
            <Aviso state={promesa} ok="Promesa guardada. El cliente pasa a “En espera” en la cola hasta esa fecha." />
          </div>
        </form>
      )}

      {pestana === "pausa" &&
        (pausado ? (
          <div className="space-y-3 text-sm">
            <p>
              La cobranza está pausada hasta el <strong>{formatFecha(pausa.hasta)}</strong>
              {pausa.motivo && <>: {pausa.motivo}</>}. Mientras tanto el cliente no aparece en la cola para hoy ni recibirá recordatorios.
            </p>
            <button
              type="button"
              disabled={reanudando}
              onClick={() =>
                startReanudar(async () => {
                  const r = await reanudarAction(clientId);
                  setErrorReanudar(r.ok ? null : r.error);
                })
              }
              className={boton}
            >
              Reanudar cobranza
            </button>
            {errorReanudar && <p className="text-red-700" role="alert">{errorReanudar}</p>}
          </div>
        ) : (
          <form action={accionPausa} className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="space-y-1 text-sm">
                <span className="text-finbra-gray">Pausar hasta</span>
                <input name="hasta" type="date" required min={addDays(hoy, 1)} max={addDays(hoy, MAX_DIAS_PAUSA)} className={input} />
              </label>
              <label className="space-y-1 text-sm">
                <span className="text-finbra-gray">Motivo</span>
                <input name="motivo" required placeholder="Ej. Negociando una reestructura" className={input} />
              </label>
            </div>
            <p className="text-xs text-finbra-gray">Mientras esté pausado, el cliente sale de la cola para hoy y no recibe recordatorios. Se reanuda solo al terminar la fecha.</p>
            <div className="flex flex-wrap items-center gap-3">
              <button type="submit" disabled={guardandoPausa} className={boton}>{guardandoPausa ? "Guardando…" : "Pausar cobranza"}</button>
              <Aviso state={pausaState} ok="Cobranza pausada." />
            </div>
          </form>
        ))}
    </div>
  );
}
