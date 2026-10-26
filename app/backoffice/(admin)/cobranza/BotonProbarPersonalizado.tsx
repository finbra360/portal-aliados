"use client";

import { useState, useTransition } from "react";
import { formatMoney } from "@/lib/format";
import { probarPersonalizadoAction, type PruebaPersonalizadoResult } from "./personalizado-actions";

/** Prueba de una sola llamada al Listado Cobranza Personalizado de SIAC (temporal, mientras se valida el formato). */
export default function BotonProbarPersonalizado() {
  const [pending, start] = useTransition();
  const [r, setR] = useState<PruebaPersonalizadoResult | null>(null);
  const m = r?.ok ? r.resumen.muestra : null;
  return (
    <span className="flex max-w-xs flex-col items-end gap-1">
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          if (window.confirm("¿Hacer una llamada de prueba al Listado Cobranza Personalizado de SIAC? Solo guarda la respuesta en la bitácora; no cambia la cartera.")) {
            start(async () => setR(await probarPersonalizadoAction()));
          }
        }}
        className="rounded-lg border border-black/10 px-4 py-2 text-sm font-medium text-finbra-gray hover:bg-black/5 disabled:opacity-50"
      >
        {pending ? "Consultando a SIAC…" : "Probar Listado Personalizado"}
      </button>
      {r &&
        (r.ok ? (
          <span className="text-right text-xs text-emerald-700" role="status">
            {r.resumen.creditos} créditos, {r.resumen.conMontoSiguiente} con monto de la siguiente cuota; página {r.resumen.paginacion.paginaActual ?? "?"} de{" "}
            {r.resumen.paginacion.paginasTotales ?? "?"} ({r.llamadas} {r.llamadas === 1 ? "llamada" : "llamadas"}).
            {m ? ` Crédito 1109: ${typeof m.montoSiguienteVencimiento === "number" ? formatMoney(m.montoSiguienteVencimiento) : String(m.montoSiguienteVencimiento)}.` : ""} Registro #{r.runId}.
          </span>
        ) : (
          <span className="text-right text-xs text-red-700" role="alert">{r.error}</span>
        ))}
    </span>
  );
}
