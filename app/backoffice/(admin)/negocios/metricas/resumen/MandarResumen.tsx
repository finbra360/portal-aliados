"use client";

import { useState, useTransition } from "react";
import { mandarResumenSemanalAction } from "../../actions";

/** «Mandar ahora»: el resumen de la semana pasada al canal de onboarding, aunque ya haya salido. */
export default function MandarResumen() {
  const [r, setR] = useState<{ ok: boolean; texto: string } | null>(null);
  const [pendiente, start] = useTransition();
  const mandar = () => {
    if (!window.confirm("¿Mandar ahora el resumen de la semana pasada al canal de onboarding de Slack?")) return;
    start(async () => {
      const x = await mandarResumenSemanalAction();
      setR(x.ok ? { ok: true, texto: x.mensaje } : { ok: false, texto: x.error });
    });
  };
  return (
    <div className="flex flex-wrap items-center gap-3">
      <button
        type="button"
        onClick={mandar}
        disabled={pendiente}
        className="rounded-lg bg-finbra-purple px-4 py-2 text-sm font-semibold text-white hover:bg-finbra-purple/90 disabled:opacity-50"
      >
        {pendiente ? "Mandando…" : "Mandar ahora a Slack"}
      </button>
      {r && (
        <p className={`text-sm ${r.ok ? "text-emerald-800" : "text-red-700"}`} role={r.ok ? "status" : "alert"}>
          {r.texto}
        </p>
      )}
    </div>
  );
}
