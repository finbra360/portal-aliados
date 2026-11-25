"use client";

// Importar de HubSpot: se elige el export (CSV), se ve la vista previa con una
// casilla por negocio abierto y se importan los marcados. El archivo se lee en
// el navegador y se manda como texto; el servidor lo vuelve a leer al importar.

import { useState, useTransition } from "react";
import Link from "next/link";
import { ETIQUETA_ETAPA, ORIGENES_NEGOCIO } from "@/lib/clientes/negocios";
import type { ParaImportar } from "@/lib/clientes/hubspot-import";
import { formatFecha, formatMoney } from "@/lib/format";
import { importarHubspotAction, vistaPreviaHubspotAction } from "../actions";

const boton = "rounded-lg bg-finbra-purple px-4 py-2 text-sm font-semibold text-white hover:bg-finbra-purple/90 disabled:opacity-50";
const secundario = "rounded-lg border border-black/10 px-3 py-1.5 text-sm hover:bg-black/5";

type Resultado = { creados: number; empresasNuevas: number; yaEstaban: number; conProblema: number };

export default function ImportarHubspot() {
  const [texto, setTexto] = useState<string | null>(null);
  const [archivo, setArchivo] = useState("");
  const [items, setItems] = useState<ParaImportar[] | null>(null);
  const [info, setInfo] = useState<{ sinEmpresa: boolean; cerrados: number } | null>(null);
  const [elegidos, setElegidos] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [resultado, setResultado] = useState<Resultado | null>(null);
  const [pendiente, startTransition] = useTransition();

  const disponibles = (items ?? []).filter((x) => !x.yaImportado && !x.problema);

  function previsualizar(t: string, conservar = false) {
    startTransition(async () => {
      const r = await vistaPreviaHubspotAction(t);
      if (!r.ok) {
        setError(r.error);
        setItems(null);
        return;
      }
      setError(null);
      setItems(r.items);
      setInfo({ sinEmpresa: r.sinEmpresa, cerrados: r.cerrados });
      if (!conservar) setElegidos(new Set(r.items.filter((x) => x.marcado).map((x) => x.fila.hubspotId)));
      else setElegidos(new Set());
    });
  }

  async function elegirArchivo(f: File | undefined) {
    setResultado(null);
    setError(null);
    if (!f) return;
    if (f.size > 900_000) {
      setError("El archivo es demasiado grande. Exporta solo los negocios (sin actividades ni notas).");
      return;
    }
    const t = await f.text();
    setArchivo(f.name);
    setTexto(t);
    previsualizar(t);
  }

  function importar() {
    if (!texto || elegidos.size === 0) return;
    if (!window.confirm(`¿Importar ${elegidos.size} ${elegidos.size === 1 ? "negocio" : "negocios"} de HubSpot?`)) return;
    startTransition(async () => {
      const r = await importarHubspotAction(texto, [...elegidos]);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setResultado(r.r);
      previsualizar(texto, true);
    });
  }

  const cambiar = (id: string, si: boolean) =>
    setElegidos((s) => {
      const n = new Set(s);
      if (si) n.add(id);
      else n.delete(id);
      return n;
    });

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <label htmlFor="archivo" className="block text-sm font-medium">Export de negocios de HubSpot (CSV)</label>
        <input id="archivo" type="file" accept=".csv,text/csv" onChange={(e) => elegirArchivo(e.target.files?.[0])} className="block text-sm" />
        <p className="text-xs text-finbra-gray">
          En HubSpot: Negocios → Exportar → formato CSV, con todas las propiedades. Súbelo tal cual, sin abrirlo en Excel.
        </p>
      </div>

      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">{error}</p>}
      {resultado && (
        <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800" role="status">
          Listo: {resultado.creados} {resultado.creados === 1 ? "negocio importado" : "negocios importados"}
          {resultado.empresasNuevas ? `, ${resultado.empresasNuevas} ${resultado.empresasNuevas === 1 ? "empresa nueva como prospecto" : "empresas nuevas como prospecto"}` : ""}
          {resultado.yaEstaban ? `; ${resultado.yaEstaban} ya estaban` : ""}
          {resultado.conProblema ? `; ${resultado.conProblema} con problema (no entraron)` : ""}.{" "}
          <Link href="/backoffice/negocios" className="font-semibold underline">Ver los negocios</Link>
        </p>
      )}
      {pendiente && <p className="text-sm text-finbra-gray" role="status">Leyendo…</p>}

      {items && info && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm">
              <span className="font-semibold">{archivo}</span>: {items.length} {items.length === 1 ? "negocio abierto" : "negocios abiertos"} ({info.cerrados} {info.cerrados === 1 ? "cerrado no se trae" : "cerrados no se traen"}).{" "}
              <span className="font-semibold">{elegidos.size} marcados.</span>
            </p>
            <div className="flex flex-wrap gap-2">
              <button type="button" className={secundario} onClick={() => setElegidos(new Set(disponibles.filter((x) => x.marcado).map((x) => x.fila.hubspotId)))}>
                Solo los activos
              </button>
              <button type="button" className={secundario} onClick={() => setElegidos(new Set(disponibles.map((x) => x.fila.hubspotId)))}>
                Todos
              </button>
              <button type="button" className={secundario} onClick={() => setElegidos(new Set())}>
                Ninguno
              </button>
            </div>
          </div>
          {info.sinEmpresa && (
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
              El archivo no trae la empresa asociada: se usa el nombre del negocio como nombre de la empresa.
            </p>
          )}
          <div className="overflow-x-auto rounded-lg border border-black/5">
            <table className="w-full min-w-[880px] text-left text-sm">
              <thead>
                <tr className="border-b border-black/5 text-xs uppercase tracking-wide text-finbra-gray">
                  <th scope="col" className="px-3 py-2"><span className="sr-only">Importar</span></th>
                  <th scope="col" className="px-3 py-2">Negocio y empresa</th>
                  <th scope="col" className="px-3 py-2">Etapa</th>
                  <th scope="col" className="px-3 py-2 text-right">Monto</th>
                  <th scope="col" className="px-3 py-2">Origen</th>
                  <th scope="col" className="px-3 py-2">Responsable</th>
                  <th scope="col" className="px-3 py-2">Última actividad</th>
                </tr>
              </thead>
              <tbody>
                {items.map((x) => {
                  const f = x.fila;
                  const bloqueado = x.yaImportado || !!x.problema;
                  return (
                    <tr key={f.hubspotId} className={`border-b border-black/5 last:border-0 ${bloqueado ? "text-finbra-gray" : ""}`}>
                      <td className="px-3 py-2 align-top">
                        <input
                          type="checkbox"
                          aria-label={`Importar ${f.nombre}`}
                          checked={elegidos.has(f.hubspotId)}
                          disabled={bloqueado}
                          onChange={(e) => cambiar(f.hubspotId, e.target.checked)}
                        />
                      </td>
                      <td className="px-3 py-2 align-top">
                        <p className="font-medium">{f.nombre}</p>
                        <p className="text-xs text-finbra-gray">
                          {x.empresa ? <>Empresa de Clientes: {x.empresa.nombre}</> : <>Empresa nueva (prospecto): {f.empresa}</>}
                        </p>
                        {x.yaImportado && <p className="text-xs font-semibold text-emerald-700">Ya importado</p>}
                        {x.problema && <p className="text-xs font-semibold text-red-700">{x.problema}</p>}
                      </td>
                      <td className="px-3 py-2 align-top">
                        {x.etapa ? ETIQUETA_ETAPA[x.etapa] : "—"}
                        <p className="text-xs text-finbra-gray">{f.etapaHubspot}</p>
                      </td>
                      <td className="px-3 py-2 text-right align-top tabular-nums">{f.monto !== null ? formatMoney(f.monto) : "—"}</td>
                      <td className="px-3 py-2 align-top">
                        {ORIGENES_NEGOCIO[x.origen]}
                        {x.tipo === "renovacion" && <p className="text-xs text-finbra-gray">Renovación</p>}
                      </td>
                      <td className="px-3 py-2 align-top">
                        {x.responsable ? x.responsable.nombre : <span className="text-finbra-gray">Tú{f.propietario ? ` (en HubSpot: ${f.propietario})` : ""}</span>}
                      </td>
                      <td className="px-3 py-2 align-top">{f.ultimaActividad ? formatFecha(f.ultimaActividad) : <span className="text-finbra-gray">Nunca</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" onClick={importar} disabled={pendiente || elegidos.size === 0} className={boton}>
              {pendiente ? "Importando…" : `Importar ${elegidos.size} ${elegidos.size === 1 ? "negocio" : "negocios"}`}
            </button>
            <p className="text-xs text-finbra-gray">Entran en su etapa, con su monto y su fecha de alta de HubSpot. Si los vuelves a subir, no se duplican.</p>
          </div>
        </div>
      )}
    </div>
  );
}
