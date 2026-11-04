"use client";

import Link from "next/link";
import { useState, useTransition, type ChangeEvent } from "react";
import { TIPOS_CONTACTO } from "@/lib/collections/contacts";
import type { FilaContacto } from "@/lib/collections/contacts-import";
import { leerArchivo } from "../../../brokers/importar/ImportarPanel";
import { importarContactosAction, previsualizarContactosAction } from "./actions";

const boton = "rounded-lg bg-finbra-purple px-4 py-2 text-sm font-semibold text-white hover:bg-finbra-purple/90 disabled:opacity-50";
const botonSecundario = "rounded-lg border border-finbra-purple px-4 py-2 text-sm font-semibold text-finbra-purple hover:bg-finbra-purple/5";

const PLANTILLA =
  "Número de cliente,Nombre,Teléfono,Correo,Tipo,Recordatorios,Notas\n" +
  "000000101,Ana Pérez López,5512345678,ana@empresa.com,Pagos,Sí,Tesorera; pagar los viernes\n" +
  "000000101,Luis Gómez,5598765432,,Contabilidad,No,\n";

const ETIQUETA: Record<FilaContacto["estado"], { texto: string; clase: string }> = {
  nuevo: { texto: "Nuevo", clase: "bg-emerald-100 text-emerald-700" },
  existe: { texto: "Ya existe", clase: "bg-black/5 text-finbra-gray" },
  error: { texto: "Error", clase: "bg-red-100 text-red-700" },
};

export default function ContactosImportarPanel() {
  const [contenido, setContenido] = useState("");
  const [archivo, setArchivo] = useState<string | null>(null);
  const [filas, setFilas] = useState<FilaContacto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hecho, setHecho] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const reiniciar = () => {
    setFilas(null);
    setError(null);
    setHecho(null);
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
      const r = await previsualizarContactosAction(contenido);
      if (r.ok) setFilas(r.filas);
      else setError(r.error);
    });

  const importar = () =>
    start(async () => {
      const r = await importarContactosAction(contenido);
      if (r.ok) {
        setHecho(r.mensaje);
        setFilas(null);
        setContenido("");
        setArchivo(null);
      } else setError(r.error);
    });

  const cuenta = (estado: FilaContacto["estado"]) => filas?.filter((f) => f.estado === estado).length ?? 0;
  const nuevos = cuenta("nuevo");
  const conRecordatorios = filas?.filter((f) => f.estado === "nuevo" && f.usarParaRecordatorios).length ?? 0;

  return (
    <div className="space-y-5">
      <div className="space-y-3 rounded-xl border border-black/5 bg-white p-5">
        <div className="flex flex-wrap items-center gap-3">
          <label className={`${botonSecundario} cursor-pointer`}>
            Subir CSV
            <input type="file" accept=".csv,.tsv,.txt,.xlsx,.xls,text/csv" onChange={elegirArchivo} className="sr-only" />
          </label>
          <a href={`data:text/csv;charset=utf-8,${encodeURIComponent("﻿" + PLANTILLA)}`} download="plantilla-contactos-cobranza.csv" className="text-sm font-semibold text-finbra-purple hover:underline">
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
            placeholder={"Número de cliente\tNombre\tTeléfono\tCorreo\tTipo\tRecordatorios\n000000101\tAna Pérez López\t5512345678\tana@empresa.com\tPagos\tSí"}
            className="w-full rounded-lg border border-black/10 px-3 py-2 font-mono text-xs"
          />
        </label>
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" onClick={revisar} disabled={pending || !contenido.trim()} className={boton}>
            {pending && !filas ? "Revisando…" : "Revisar"}
          </button>
          {error && <p className="text-sm text-red-700" role="alert">{error}</p>}
          {hecho && (
            <>
              <p className="text-sm text-emerald-700" role="status">{hecho}</p>
              <Link href="/backoffice/cobranza/clientes" className="text-sm font-semibold text-finbra-purple hover:underline">Ver clientes →</Link>
            </>
          )}
        </div>
      </div>

      {filas && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm">
              <strong>{nuevos}</strong> {nuevos === 1 ? "contacto nuevo" : "contactos nuevos"}
              {conRecordatorios > 0 && <> ({conRecordatorios} para recibir los recordatorios)</>} · {cuenta("existe")} {cuenta("existe") === 1 ? "ya existe" : "ya existen"} (se omiten) · {cuenta("error")} con error (se omiten)
            </p>
            <button
              type="button"
              onClick={() => {
                if (window.confirm(nuevos === 1 ? "¿Dar de alta 1 contacto?" : `¿Dar de alta ${nuevos} contactos?`)) importar();
              }}
              disabled={pending || nuevos === 0}
              className={boton}
            >
              {pending ? "Guardando…" : nuevos === 1 ? "Dar de alta 1 contacto" : `Dar de alta ${nuevos} contactos`}
            </button>
          </div>
          <div className="overflow-x-auto rounded-xl border border-black/5 bg-white">
            <table className="w-full min-w-[900px] text-left text-sm">
              <thead>
                <tr className="border-b border-black/5 text-xs uppercase tracking-wide text-finbra-gray">
                  <th className="px-4 py-2">Fila</th>
                  <th className="px-4 py-2">Estado</th>
                  <th className="px-4 py-2">Cliente</th>
                  <th className="px-4 py-2">Contacto</th>
                  <th className="px-4 py-2">Tipo</th>
                  <th className="px-4 py-2">Recordatorios</th>
                  <th className="px-4 py-2">Detalle</th>
                </tr>
              </thead>
              <tbody>
                {filas.map((f, i) => (
                  <tr key={`${f.fila}-${i}`} className="border-b border-black/5 align-top last:border-0">
                    <td className="px-4 py-2 text-finbra-gray">{f.fila}</td>
                    <td className="px-4 py-2">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${ETIQUETA[f.estado].clase}`}>{ETIQUETA[f.estado].texto}</span>
                    </td>
                    <td className="px-4 py-2">{f.cliente ?? "—"}</td>
                    <td className="px-4 py-2">
                      {f.nombre && <span className="block">{f.nombre}</span>}
                      <span className="text-finbra-gray">{f.valor || "—"}</span>
                    </td>
                    <td className="px-4 py-2 text-finbra-gray">{TIPOS_CONTACTO[f.tipoContacto].label}</td>
                    <td className="px-4 py-2">{f.usarParaRecordatorios ? "Sí" : "—"}</td>
                    <td className={`px-4 py-2 ${f.estado === "error" ? "text-red-700" : "text-finbra-gray"}`}>
                      {f.estado === "existe" ? (f.detalle ?? "Se omite") : (f.detalle ?? "")}
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
