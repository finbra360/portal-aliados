"use client";

import { useState, useTransition } from "react";
import { correrRadarAction, type RadarActionResult } from "./actions";

/** Botón de Super Admin para correr el radar sin esperar al cron de mañana. */
export default function CorrerRadar() {
  const [r, setR] = useState<RadarActionResult | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="flex flex-wrap items-center gap-3">
      <button
        type="button"
        disabled={pending}
        onClick={() => start(async () => setR(await correrRadarAction()))}
        className="rounded-lg border border-finbra-purple/30 px-3 py-1.5 text-sm font-semibold text-finbra-purple-700 hover:bg-finbra-purple/5 disabled:opacity-50"
      >
        {pending ? "Revisando…" : "Revisar ahora"}
      </button>
      {r && (r.ok ? <p className="text-sm text-emerald-700" role="status">{r.mensaje}</p> : <p className="text-sm text-red-700" role="alert">{r.error}</p>)}
    </div>
  );
}
