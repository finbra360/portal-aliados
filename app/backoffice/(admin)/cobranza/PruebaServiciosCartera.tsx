"use client";

import { useState, useTransition } from "react";
import type { ResultadoServicio } from "@/lib/db/siac-prueba-cartera";
import { probarServiciosCarteraAction, type PruebaCarteraResult } from "./prueba-cartera-actions";

function Bloque({ titulo, r, tipo }: { titulo: string; r: ResultadoServicio; tipo: "creditos" | "clientes" }) {
  if (!r.ok) {
    return (
      <div className="space-y-1 rounded-lg border border-red-200 bg-red-50 p-3">
        <p className="text-sm font-semibold">{titulo}</p>
        <p className="text-xs text-red-700">{r.error}</p>
      </div>
    );
  }
  const s = r.resumen;
  const dato = (etiqueta: string, valor: string) => (
    <p className="text-xs">
      <span className="text-finbra-gray">{etiqueta}: </span>
      {valor}
    </p>
  );
  return (
    <div className="space-y-1 rounded-lg border border-black/10 bg-white p-3">
      <p className="text-sm font-semibold">{titulo}</p>
      {dato("Respuesta de SIAC", s.detalle ?? "sin «Detalle»")}
      {dato("Registros", String(s.registros))}
      {Object.keys(s.sobre).length > 0 && dato("Sobre", Object.entries(s.sobre).map(([k, v]) => `${k}=${v}`).join(", "))}
      {tipo === "creditos" && dato("Créditos que no están hoy en el listado de cobranza", s.creditosFueraDelListado === null ? "no se reconoce el campo del número de crédito" : String(s.creditosFueraDelListado))}
      {dato("Clientes que no tenemos", s.clientesNuevos === null ? "no se reconoce el campo del número de cliente" : String(s.clientesNuevos))}
      {dato("RFC", s.campoRfc ? `campo ${s.campoRfc}, ${s.conRfc} con valor` : "no viene")}
      {dato("Estatus", s.campoEstatus ? `${s.campoEstatus}: ${s.estatus.map((e) => `${e.valor} (${e.n})`).join(", ")}` : "no se reconoce")}
      {s.camposFecha.length > 0 && dato("Fechas", s.camposFecha.join(", "))}
      {s.campos.length > 0 && dato("Todos los campos", s.campos.join(", "))}
    </div>
  );
}

/**
 * Prueba temporal de dos servicios de SIAC que podrían traer a los ex clientes
 * (ConsultarVistaCredito y ConsultarClientes). Una llamada a cada uno; solo
 * guarda las respuestas en la bitácora de llamadas, no cambia la cartera.
 */
export default function PruebaServiciosCartera() {
  const [pending, start] = useTransition();
  const [r, setR] = useState<PruebaCarteraResult | null>(null);
  return (
    <div className="space-y-3 rounded-xl border border-dashed border-black/15 bg-white/60 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold">Prueba: ¿SIAC tiene los créditos liquidados?</p>
          <p className="text-xs text-finbra-gray">
            Una llamada a ConsultarVistaCredito y otra a ConsultarClientes. Solo guarda la respuesta en la bitácora de llamadas; no cambia la cartera.
          </p>
        </div>
        <button
          type="button"
          disabled={pending}
          onClick={() => {
            if (window.confirm("¿Hacer una llamada de prueba a ConsultarVistaCredito y otra a ConsultarClientes de SIAC? No cambia la cartera.")) {
              start(async () => setR(await probarServiciosCarteraAction()));
            }
          }}
          className="rounded-lg border border-black/10 px-4 py-2 text-sm font-medium text-finbra-gray hover:bg-black/5 disabled:opacity-50"
        >
          {pending ? "Consultando a SIAC…" : "Probar servicios de SIAC"}
        </button>
      </div>
      {r &&
        (r.ok ? (
          <div className="space-y-2">
            <div className="grid gap-3 lg:grid-cols-2">
              <Bloque titulo="ConsultarVistaCredito (créditos)" r={r.vista} tipo="creditos" />
              <Bloque titulo="ConsultarClientes" r={r.clientes} tipo="clientes" />
            </div>
            <p className="text-xs text-finbra-gray">
              Registro #{r.runId} · {r.llamadas} {r.llamadas === 1 ? "llamada" : "llamadas"} a SIAC. La respuesta completa quedó en la bitácora (col_siac_raw).
            </p>
          </div>
        ) : (
          <p className="text-xs text-red-700" role="alert">{r.error}</p>
        ))}
    </div>
  );
}
