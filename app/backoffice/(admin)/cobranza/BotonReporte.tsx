"use client";

import { useState, useTransition } from "react";
import { enviarReporteAction } from "./reporte-actions";

export default function BotonReporte() {
  const [pending, start] = useTransition();
  const [r, setR] = useState<{ ok: true } | { ok: false; error: string } | null>(null);
  return (
    <span className="flex flex-col items-end gap-1">
      <button
        type="button"
        disabled={pending}
        onClick={() => start(async () => setR(await enviarReporteAction()))}
        className="rounded-lg border border-finbra-purple px-4 py-2 text-sm font-semibold text-finbra-purple-700 hover:bg-finbra-purple/5 disabled:opacity-50"
        title="El reporte también sale solo todos los días después de las 9:00"
      >
        {pending ? "Enviando…" : "Mandar reporte a Slack"}
      </button>
      {r && (r.ok ? <span className="text-xs text-emerald-700" role="status">Enviado a Slack.</span> : <span className="text-xs text-red-700" role="alert">{r.error}</span>)}
    </span>
  );
}
