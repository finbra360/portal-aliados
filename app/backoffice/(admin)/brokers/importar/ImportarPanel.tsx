"use client";

import Link from "next/link";
import { useState, useTransition, type ChangeEvent } from "react";
import type { FilaImportacion } from "@/lib/brokers/importar";
import { importarBrokersAction, previsualizarImportacionAction, type BrokerActionResult } from "../actions";
import { Aviso, boton, botonSecundario } from "../BrokerForms";

const PLANTILLA = "Email,Nombre completo,Telefono,ID Broker\nana.perez@ejemplo.com,Ana Pérez López,5512345678,\n";

/** Excel guarda "CSV" en Windows-1252 y "CSV UTF-8" en UTF-8: se aceptan los dos. */
async function leerArchivo(archivo: File): Promise<string> {
  const bytes = await archivo.arrayBuffer();
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("windows-1252").decode(bytes);
  }
}

const ETIQUETA: Record<FilaImportacion["estado"], { texto: string; clase: string }> = {
  nuevo: { texto: "Nuevo", clase: "bg-emerald-100 text-emerald-700" },
  existe: { texto: "Ya existe", clase: "bg-black/5 text-finbra-gray" },
  error: { texto: "Error", clase: "bg-red-100 text-red-700" },
};

export default function ImportarPanel() {
  const [contenido, setContenido] = useState("");
  const [archivo, setArchivo] = useState<string | null>(null);
  const [filas, setFilas] = useState<FilaImportacion[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [resultado, setResultado] = useState<BrokerActionResult | null>(null);
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
      const r = await previsualizarImportacionAction(contenido);
      if (r.ok) setFilas(r.filas);
      else setError(r.error);
    });

  const importar = () =>
    start(async () => {
      const r = await importarBrokersAction(contenido);
      setResultado(r);
      if (r.ok) {
        setFilas(null);
        setContenido("");
        setArchivo(null);
      }
    });

  const cuenta = (estado: FilaImportacion["estado"]) => filas?.filter((f) => f.estado === estado).length ?? 0;
  const nuevos = cuenta("nuevo");

  return (
    <div className="space-y-5">
      <div className="space-y-3 rounded-xl border border-black/5 bg-white p-5">
        <div className="flex flex-wrap items-center gap-3">
          <label className={`${botonSecundario} cursor-pointer`}>
            Subir CSV
            <input type="file" accept=".csv,.tsv,.txt,.xlsx,.xls,text/csv" onChange={elegirArchivo} className="sr-only" />
          </label>
          <a href={`data:text/csv;charset=utf-8,${encodeURIComponent("﻿" + PLANTILLA)}`} download="plantilla-brokers.csv" className="text-sm font-semibold text-finbra-purple hover:underline">
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
            placeholder={"Email\tNombre completo\tTelefono\tID Broker\nana.perez@ejemplo.com\tAna Pérez López\t5512345678\t"}
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
              <strong>{nuevos}</strong> {nuevos === 1 ? "nuevo" : "nuevos"} · {cuenta("existe")} ya existen (se omiten) · {cuenta("error")} con error (se omiten)
            </p>
            <button
              type="button"
              onClick={() => {
                if (window.confirm(nuevos === 1 ? "¿Dar de alta 1 broker?" : `¿Dar de alta ${nuevos} brokers?`)) importar();
              }}
              disabled={pending || nuevos === 0}
              className={boton}
            >
              {pending ? "Guardando…" : nuevos === 1 ? "Dar de alta 1 broker" : `Dar de alta ${nuevos} brokers`}
            </button>
          </div>
          <div className="overflow-x-auto rounded-xl border border-black/5 bg-white">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead>
                <tr className="border-b border-black/5 text-xs uppercase tracking-wide text-finbra-gray">
                  <th className="px-4 py-2">Fila</th>
                  <th className="px-4 py-2">Estado</th>
                  <th className="px-4 py-2">Nombre</th>
                  <th className="px-4 py-2">Correo</th>
                  <th className="px-4 py-2">Teléfono</th>
                  <th className="px-4 py-2">ID</th>
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
                    <td className="px-4 py-2">{f.nombre || "—"}</td>
                    <td className="px-4 py-2">{f.email || "—"}</td>
                    <td className="px-4 py-2 text-finbra-gray">{f.telefono ?? "—"}</td>
                    <td className="px-4 py-2 text-finbra-gray">{f.id ?? (f.estado === "nuevo" ? "se asigna" : "—")}</td>
                    <td className={`px-4 py-2 ${f.estado === "error" ? "text-red-700" : "text-finbra-gray"}`}>
                      {f.estado === "existe" ? "Se omite" : (f.detalle ?? "")}
                    </td>
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
