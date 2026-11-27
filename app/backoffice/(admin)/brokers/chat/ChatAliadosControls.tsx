"use client";

import { useEffect, useState, useTransition } from "react";
import { marcarLeidoAliadoAction, responderAliadoAction } from "./actions";

/** Al abrir una conversación con mensajes sin leer, se marcan como leídos. */
export function MarcarLeido({ telefono, sinLeer }: { telefono: string; sinLeer: number }) {
  useEffect(() => {
    if (sinLeer > 0) void marcarLeidoAliadoAction(telefono);
  }, [telefono, sinLeer]);
  return null;
}

export function ResponderAliado({ telefono, habilitado, motivo }: { telefono: string; habilitado: boolean; motivo: string | null }) {
  const [texto, setTexto] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  if (!habilitado) return <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">{motivo}</p>;
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          setError(null);
          const r = await responderAliadoAction(telefono, texto);
          if (r.ok) setTexto("");
          else setError(r.error);
        });
      }}
      className="space-y-2"
    >
      <label htmlFor="respuesta-aliado" className="sr-only">Respuesta</label>
      <textarea
        id="respuesta-aliado"
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        rows={3}
        maxLength={4096}
        placeholder="Escribe tu respuesta (sale desde el WhatsApp de Aliados, 55 9990 0795)"
        className="w-full rounded-lg border border-black/10 px-3 py-2 text-sm"
      />
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={pending || !texto.trim()}
          className="rounded-lg bg-finbra-purple px-4 py-2 text-sm font-semibold text-white hover:bg-finbra-purple/90 disabled:opacity-50"
        >
          {pending ? "Enviando…" : "Enviar"}
        </button>
        {error && <p className="text-sm text-red-700" role="alert">{error}</p>}
      </div>
    </form>
  );
}
