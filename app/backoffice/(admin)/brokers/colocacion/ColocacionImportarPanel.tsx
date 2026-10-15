"use client";

import Link from "next/link";
import { useState, useTransition, type ChangeEvent } from "react";
import type { FilaColocacion } from "@/lib/brokers/colocacion";
import { formatCurrency } from "@/lib/format";
import { importarColocacionAction, previsualizarColocacionAction, type ColocacionActionResult } from "../colocacion-actions";
import { leerArchivo } from "../importar/ImportarPanel";

const boton = "rounded-lg bg-finbra-purple px-4 py-2 text-sm font-semibold text-white hover:bg-finbra-purple/90 disabled:opacity-50";
const botonSecundario = "rounded-lg border border-finbra-purple/30 px-4 py-2 text-sm font-semibold text-finbra-purple hover:bg-finbra-purple/5";

const PLANTILLA = "ID Broker,Fecha,Monto MXN,Comisión Apertura %,Pagado en su totalidad,Referencia\nFAPBR001,2026-06-15,850000,5,No,Cliente ejemplo\n";

const ETIQUETA: Record<FilaColocacion["estado"], { texto: string; clase: string }> = {
  nuevo: { texto: "Nueva", clase: "bg-emerald-100 text-emerald-700" },
  existe: { texto: "Ya guardada", clase: "bg-black/5 text-finbra-gray" },
  error: { texto: "Error", clase: "bg-red-100 text-red-700" },
};

function Aviso({ state }: { state: ColocacionActionResult | null }) {
  if (!state) return null;
  return state.ok ? (
    state.mensaje ? <p className="text-sm text-emerald-700" role="status">{state.mensaje}</p> : null
  ) : (
    <p className="text-sm text-red-700" role="alert">{state.error}</p>
  );
}

export default function ColocacionImportarPanel() {
  const [contenido, setContenido] = useState("");
  const [archivo, setArchivo] = useState<string | null>(null);
  const [filas, setFilas] = useState<FilaColocacion[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [resultado, setResultado] = useState<ColocacionActionResult | null>(null);
  const [pending, start] = useTransition();

  const reiniciar = () => {
    setFilas(null);
    setError(null);
    setResultado(null);
  };

  const elegirArchivo = async (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    reiniciar();
    if (/\.xlsx?$/i.test(f.name)) {
      setError("Ese es un archivo de Excel. Guárdalo como CSV (Archivo → Guardar como → CSV) o copia las celdas y pégalas abajo.");
      return;
    }
    setArchivo(f.name);
    setContenido(await leerArchivo(f));
  };

  const revisar = () =>
    start(async () => {
      reiniciar();
      const r = await previsualizarColocacionAction(contenido);
      if (r.ok) setFilas(r.filas);
      else setError(r.error);
    });

  const importar = () =>
    start(async () => {
      const r = await importarColocacionAction(contenido);
      setResultado(r);
      if (r.ok) {
        setFilas(null);
        setContenido("");
        setArchivo(null);
      }
    });

  const nuevas = filas?.filter((f) => f.estado === "nuevo") ?? [];
  const cuenta = (estado: FilaColocacion["estado"]) => filas?.filter((f) => f.estado === estado).length ?? 0;
  const montoNuevo = nuevas.reduce((s, f) => s + (f.monto ?? 0), 0);

  return (
    <div className="space-y-5">
      <div className="space-y-3 rounded-xl border border-black/5 bg-white p-5">
        <div className="flex flex-wrap items-center gap-3">
          <label className={`${botonSecundario} cursor-pointer`}>
            Subir CSV
            <input type="file" accept=".csv,.tsv,.txt,.xlsx,.xls,text/csv" onChange={elegirArchivo} className="sr-only" />
          </label>
          <a href={`data:text/csv;charset=utf-8,${encodeURIComponent("﻿" + PLANTILLA)}`} download="plantilla-colocacion.csv" className="text-sm font-semibold text-finbra-purple hover:underline">
            Descargar plantilla
          </a>
          {archivo && <span className="text-sm text-finbra-gray">Archivo: {archivo}</span>}
        </div>
        <label className="block space-y-1 text-sm">
          <span className="text-finbra-gray">…o pega aquí las celdas copiadas de Excel o Google Sheets (con la fila de encabezados)</span>
          <textarea
            value={contenido}
            onChange={(e) => {
              setContenido(e.target.value);
              setArchivo(null);
              reiniciar();
            }}
            rows={8}
            spellCheck={false}
            placeholder={"ID Broker\tFecha\tMonto MXN\tComisión Apertura %\tPagado en su totalidad\tReferencia\nFAPBR001\t2026-06-15\t850000\t5\tNo\tCliente ejemplo"}
            className="w-full rounded-lg border border-black/10 px-3 py-2 font-mono text-xs"
          />
        </label>
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" onClick={revisar} disabled={pending || !contenido.trim()} className={boton}>
            {pending && !filas ? "Revisando…" : "Revisar"}
          </button>
          {error && <p className="text-sm text-red-700" role="alert">{error}</p>}
          <Aviso state={resultado} />
          {resultado?.ok && (
            <Link href="/backoffice/brokers" className="text-sm font-semibold text-finbra-purple hover:underline">
              Ver brokers →
            </Link>
          )}
        </div>
      </div>

      {filas && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm">
              <strong>{nuevas.length}</strong> {nuevas.length === 1 ? "nueva" : "nuevas"} ({formatCurrency(montoNuevo)}) · {cuenta("existe")} ya guardadas (se omiten) · {cuenta("error")} con error (se omiten)
            </p>
            <button
              type="button"
              onClick={() => {
                if (window.confirm(nuevas.length === 1 ? `¿Guardar 1 operación por ${formatCurrency(montoNuevo)}?` : `¿Guardar ${nuevas.length} operaciones por ${formatCurrency(montoNuevo)}?`)) importar();
              }}
              disabled={pending || nuevas.length === 0}
              className={boton}
            >
              {pending ? "Guardando…" : nuevas.length === 1 ? "Guardar 1 operación" : `Guardar ${nuevas.length} operaciones`}
            </button>
          </div>
          <div className="overflow-x-auto rounded-xl border border-black/5 bg-white">
            <table className="w-full min-w-[820px] text-left text-sm">
              <thead>
                <tr className="border-b border-black/5 text-xs uppercase tracking-wide text-finbra-gray">
                  <th className="px-4 py-2">Fila</th>
                  <th className="px-4 py-2">Estado</th>
                  <th className="px-4 py-2">Broker</th>
                  <th className="px-4 py-2">Fecha</th>
                  <th className="px-4 py-2">Monto</th>
                  <th className="px-4 py-2">Apertura</th>
                  <th className="px-4 py-2">Pagado</th>
                  <th className="px-4 py-2">Referencia</th>
                  <th className="px-4 py-2">Detalle</th>
                </tr>
              </thead>
              <tbody>
                {filas.map((f) => (
                  <tr key={f.fila} className="border-b border-black/5 last:border-0">
                    <td className="px-4 py-2 text-finbra-gray">{f.fila}</td>
                    <td className="px-4 py-2">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${ETIQUETA[f.estado].clase}`}>{ETIQUETA[f.estado].texto}</span>
                    </td>
                    <td className="px-4 py-2">{f.brokerId || "—"}</td>
                    <td className="px-4 py-2 whitespace-nowrap">{f.fecha || "—"}</td>
                    <td className="px-4 py-2">{f.monto === null ? "—" : formatCurrency(f.monto)}</td>
                    <td className="px-4 py-2 text-finbra-gray">{f.comisionAperturaPct === null ? "—" : `${f.comisionAperturaPct}%`}</td>
                    <td className="px-4 py-2 text-finbra-gray">{f.estado === "error" ? "—" : f.pagadoTotalidad ? "Sí" : "No"}</td>
                    <td className="px-4 py-2 text-finbra-gray">{f.referencia ?? "—"}</td>
                    <td className={`px-4 py-2 ${f.estado === "error" ? "text-red-700" : "text-finbra-gray"}`}>{f.estado === "existe" ? "Se omite" : (f.detalle ?? "")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
