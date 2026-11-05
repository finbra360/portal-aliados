"use client";

import Link from "next/link";
import { useState, useTransition, type ChangeEvent } from "react";
import { NUEVA, type Destino, type Elecciones, type PlanEmpresa } from "@/lib/clientes/importar-hubspot";
import type { VistaPreviaHubspot } from "@/lib/db/importar-hubspot";
import { formatFecha, formatMoney } from "@/lib/format";
import { leerArchivo } from "../../brokers/importar/ImportarPanel";
import { importarHubspotAction, previsualizarHubspotAction } from "./actions";

const boton = "rounded-lg bg-finbra-purple px-4 py-2 text-sm font-semibold text-white hover:bg-finbra-purple/90 disabled:opacity-50";
const botonSecundario = "rounded-lg border border-finbra-purple px-4 py-2 text-sm font-semibold text-finbra-purple hover:bg-finbra-purple/5";

const MOTIVO = {
  manual: "porque la elegiste aquí",
  numero_cliente: "por número de cliente",
  hubspot: "por ID de HubSpot",
  nombre: "por nombre",
} as const;

type Empresa = VistaPreviaHubspot["empresas"][number];

/** El destino que se va a usar: lo elegido en el menú o, si no se tocó, el automático. */
function destinoEfectivo(p: PlanEmpresa, elecciones: Elecciones, empresas: Map<string, Empresa>): Destino {
  const elegida = elecciones[p.clave];
  if (elegida === NUEVA) return { tipo: "nueva" };
  const e = elegida ? empresas.get(elegida) : undefined;
  if (e) return { tipo: "existente", empresaId: e.empresaId, nombre: e.nombre, motivo: "manual" };
  return p.destino;
}

export default function ImportarHubspotPanel() {
  const [contenido, setContenido] = useState("");
  const [archivo, setArchivo] = useState<string | null>(null);
  const [plan, setPlan] = useState<PlanEmpresa[] | null>(null);
  const [empresas, setEmpresas] = useState<Empresa[]>([]);
  const [elecciones, setElecciones] = useState<Elecciones>({});
  const [soloNuevas, setSoloNuevas] = useState(false);
  const [errores, setErrores] = useState<{ fila: number; error: string }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [hecho, setHecho] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const reiniciar = () => {
    setPlan(null);
    setEmpresas([]);
    setElecciones({});
    setErrores([]);
    setError(null);
    setHecho(null);
  };

  const elegirArchivo = async (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    reiniciar();
    if (/\.xlsx?$/i.test(f.name)) {
      setError("Ese es un archivo de Excel. Guárdalo como CSV o copia las celdas y pégalas abajo.");
      return;
    }
    setArchivo(f.name);
    setContenido(await leerArchivo(f));
  };

  const revisar = () =>
    start(async () => {
      reiniciar();
      const r = await previsualizarHubspotAction(contenido);
      if (r.ok) {
        setPlan(r.plan);
        setEmpresas(r.empresas);
        setErrores(r.errores);
      } else setError(r.error);
    });

  const importar = () =>
    start(async () => {
      const r = await importarHubspotAction(contenido, elecciones);
      if (r.ok) {
        setHecho(r.mensaje);
        setPlan(null);
        setEmpresas([]);
        setElecciones({});
        setErrores([]);
        setContenido("");
        setArchivo(null);
      } else setError(r.error);
    });

  const porId = new Map(empresas.map((e) => [e.empresaId, e]));
  const filas = (plan ?? []).map((p) => ({ p, destino: destinoEfectivo(p, elecciones, porId) }));
  const validas = filas.filter((f) => f.destino.tipo !== "error");
  const negocios = validas.reduce((s, f) => s + f.p.negocios.length, 0);
  const nuevas = validas.filter((f) => f.destino.tipo === "nueva").length;
  const visibles = soloNuevas ? filas.filter((f) => f.destino.tipo !== "existente") : filas;

  return (
    <div className="space-y-5">
      <div className="space-y-3 rounded-xl border border-black/5 bg-white p-5">
        <div className="flex flex-wrap items-center gap-3">
          <label className={`${botonSecundario} cursor-pointer`}>
            Subir CSV
            <input type="file" accept=".csv,.tsv,.txt,.xlsx,.xls,text/csv" onChange={elegirArchivo} className="sr-only" />
          </label>
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
            rows={6}
            spellCheck={false}
            className="w-full rounded-lg border border-black/10 px-3 py-2 font-mono text-xs"
          />
        </label>
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" onClick={revisar} disabled={pending || !contenido.trim()} className={boton}>
            {pending && !plan ? "Revisando…" : "Revisar"}
          </button>
          {error && <p className="text-sm text-red-700" role="alert">{error}</p>}
          {hecho && (
            <>
              <p className="text-sm text-emerald-700" role="status">{hecho}</p>
              <Link href="/backoffice/clientes?filtro=ex_clientes" className="text-sm font-semibold text-finbra-purple hover:underline">Ver ex clientes →</Link>
            </>
          )}
        </div>
      </div>

      {plan && (
        <div className="space-y-3">
          <p className="rounded-lg bg-finbra-purple/5 px-4 py-2 text-sm text-finbra-purple-700">
            Si una empresa ya es tu cliente en SIAC con otro nombre, elígela en el menú de la columna «Se guarda como» para que no se duplique. Lo que
            elijas manda sobre el cruce automático.
          </p>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm">
              <strong>{negocios}</strong> negocios de <strong>{validas.length}</strong> empresas ({nuevas} nuevas, {validas.length - nuevas} ligadas a clientes que ya existen)
              {filas.length - validas.length > 0 && <> · {filas.length - validas.length} empresas con error (se omiten)</>}
              {errores.length > 0 && <> · {errores.length} filas con error (se omiten)</>}
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-2 text-sm text-finbra-gray">
                <input type="checkbox" checked={soloNuevas} onChange={(e) => setSoloNuevas(e.target.checked)} id="solo-nuevas" />
                Ver solo las nuevas y con error
              </label>
              <button
                type="button"
                onClick={() => {
                  if (window.confirm(`¿Importar ${negocios} negocios de ${validas.length} empresas (${nuevas} nuevas)?`)) importar();
                }}
                disabled={pending || negocios === 0}
                className={boton}
              >
                {pending ? "Importando…" : "Importar"}
              </button>
            </div>
          </div>

          {errores.length > 0 && (
            <ul className="space-y-1 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
              {errores.map((e) => (
                <li key={e.fila}>Fila {e.fila}: {e.error}</li>
              ))}
            </ul>
          )}

          <div className="overflow-x-auto rounded-xl border border-black/5 bg-white">
            <table className="w-full min-w-[1000px] text-left text-sm">
              <thead>
                <tr className="border-b border-black/5 text-xs uppercase tracking-wide text-finbra-gray">
                  <th className="px-4 py-2">Empresa en HubSpot</th>
                  <th className="px-4 py-2">Negocios</th>
                  <th className="px-4 py-2 text-right">Monto (HubSpot)</th>
                  <th className="px-4 py-2">Cierres</th>
                  <th className="px-4 py-2">Se guarda como</th>
                </tr>
              </thead>
              <tbody>
                {visibles.map(({ p, destino }) => {
                  const valor = destino.tipo === "existente" ? destino.empresaId : destino.tipo === "nueva" ? NUEVA : "";
                  const id = `destino-${p.clave.replace(/\W+/g, "-")}`;
                  return (
                    <tr key={p.clave} className="border-b border-black/5 align-top last:border-0">
                      <td className="px-4 py-2 font-medium">{p.nombre}</td>
                      <td className="px-4 py-2 text-xs text-finbra-gray">
                        {p.negocios.map((n) => (
                          <span key={n.dealId} className="block">{n.negocio}</span>
                        ))}
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums">{formatMoney(p.monto)}</td>
                      <td className="whitespace-nowrap px-4 py-2 text-xs">
                        {p.primerCierre === p.ultimoCierre ? formatFecha(p.ultimoCierre) : `${formatFecha(p.primerCierre)} – ${formatFecha(p.ultimoCierre)}`}
                      </td>
                      <td className="px-4 py-2">
                        <label htmlFor={id} className="sr-only">Con qué empresa se guarda {p.nombre}</label>
                        <select
                          id={id}
                          value={valor}
                          onChange={(e) => setElecciones((prev) => ({ ...prev, [p.clave]: e.target.value }))}
                          className={`w-72 max-w-full rounded-lg border px-2 py-1 text-sm ${
                            destino.tipo === "error" ? "border-red-300 bg-red-50" : destino.tipo === "nueva" ? "border-finbra-purple/30 bg-finbra-purple/5" : "border-emerald-300 bg-emerald-50"
                          }`}
                        >
                          {destino.tipo === "error" && <option value="">Elige una opción…</option>}
                          <option value={NUEVA}>Empresa nueva (ex cliente)</option>
                          {empresas.map((e) => (
                            <option key={e.empresaId} value={e.empresaId}>
                              {e.nombre}
                              {e.numerosCliente.length ? ` · ${e.numerosCliente.join(", ")}` : ""}
                            </option>
                          ))}
                        </select>
                        <span className={`mt-1 block text-xs ${destino.tipo === "error" ? "text-red-700" : "text-finbra-gray"}`}>
                          {destino.tipo === "error" ? destino.error : destino.tipo === "existente" ? `Se liga ${MOTIVO[destino.motivo]}` : "Se crea como empresa nueva"}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
