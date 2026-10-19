"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { enviarSinBorrar } from "../enviarSinBorrar";
import { responderAction, retomarAction, setBajaAction, type ChatActionResult } from "./actions";

/** Vuelve a pedir la página cada 15 s mientras la pestaña está visible: así llegan los mensajes nuevos. */
export function AutoRefresh({ segundos = 15 }: { segundos?: number }) {
  const router = useRouter();
  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, segundos * 1000);
    return () => clearInterval(id);
  }, [router, segundos]);
  return null;
}

/** Baja hasta el último mensaje al abrir la conversación o cuando llega uno nuevo. */
export function AlFinal({ cuantos }: { cuantos: number }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.scrollIntoView({ block: "end" });
  }, [cuantos]);
  return <div ref={ref} />;
}

const AvisoError = ({ r }: { r: ChatActionResult | null }) => (r && !r.ok ? <p className="text-sm text-red-700" role="alert">{r.error}</p> : null);

export function Responder({ telefono }: { telefono: string }) {
  const [form, setForm] = useState(0);
  const [state, accion, enviando] = useActionState(async (prev: ChatActionResult | null, fd: FormData) => {
    const r = await responderAction(telefono, prev, fd);
    if (r.ok) setForm((n) => n + 1);
    return r;
  }, null);
  return (
    <form key={form} onSubmit={enviarSinBorrar(accion)} className="space-y-2">
      <div className="flex items-end gap-2">
        <textarea
          name="texto"
          rows={2}
          required
          maxLength={4096}
          placeholder="Escribe una respuesta…"
          className="min-h-[2.75rem] flex-1 resize-y rounded-lg border border-black/10 bg-white px-3 py-2 text-sm"
          onKeyDown={(e) => {
            // Enter envía; Shift+Enter hace salto de línea.
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              e.currentTarget.form?.requestSubmit();
            }
          }}
        />
        <button type="submit" disabled={enviando} className="rounded-lg bg-finbra-purple px-4 py-2 text-sm font-semibold text-white hover:bg-finbra-purple/90 disabled:opacity-50">
          {enviando ? "Enviando…" : "Enviar"}
        </button>
      </div>
      <AvisoError r={state} />
    </form>
  );
}

export function Retomar({ telefono, disponible }: { telefono: string; disponible: boolean }) {
  const [pending, start] = useTransition();
  const [r, setR] = useState<ChatActionResult | null>(null);
  return (
    <div className="space-y-2">
      <p className="text-sm text-finbra-gray">
        Pasaron más de 24 horas desde el último mensaje del cliente: Meta solo deja escribirle con una plantilla aprobada. Cuando conteste, se vuelve a abrir el texto libre.
      </p>
      {disponible ? (
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            start(async () => {
              if (!window.confirm('¿Enviar la plantilla "¿Tienes un momento para platicar?" para retomar la conversación?')) return;
              setR(await retomarAction(telefono));
            })
          }
          className="rounded-lg border border-finbra-purple px-4 py-2 text-sm font-semibold text-finbra-purple-700 hover:bg-finbra-purple/5 disabled:opacity-50"
        >
          {pending ? "Enviando…" : "Retomar la conversación"}
        </button>
      ) : (
        <p className="text-xs text-finbra-gray">La plantilla para retomar (finbra_contacto) todavía no está aprobada en Meta.</p>
      )}
      <AvisoError r={r} />
    </div>
  );
}

export function BajaToggle({ telefono, dadoDeBaja }: { telefono: string; dadoDeBaja: boolean }) {
  const [pending, start] = useTransition();
  const [r, setR] = useState<ChatActionResult | null>(null);
  return (
    <span className="flex flex-col items-end gap-1">
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const msg = dadoDeBaja ? "¿Volver a mandarle recordatorios por WhatsApp a este número?" : "¿Marcar que este número no quiere recibir WhatsApp? Deja de recibir recordatorios.";
            if (window.confirm(msg)) setR(await setBajaAction(telefono, !dadoDeBaja));
          })
        }
        className="rounded-lg px-3 py-1.5 text-xs font-medium text-finbra-gray hover:bg-black/5 disabled:opacity-50"
      >
        {dadoDeBaja ? "Reactivar WhatsApp" : "Marcar BAJA"}
      </button>
      <AvisoError r={r} />
    </span>
  );
}
