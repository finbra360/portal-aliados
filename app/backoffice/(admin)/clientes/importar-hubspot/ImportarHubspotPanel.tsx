"use client";

import Link from "next/link";
import { useState, useTransition, type ChangeEvent } from "react";
import type { PlanEmpresa } from "@/lib/clientes/importar-hubspot";
import { formatFecha, formatMoney } from "@/lib/format";
import { leerArchivo } from "../../brokers/importar/ImportarPanel";
import { importarHubspotAction, previsualizarHubspotAction } from "./actions";

const boton = "rounded-lg bg-finbra-purple px-4 py-2 text-sm font-semibold text-white hover:bg-finbra-purple/90 disabled:opacity-50";
const botonSecundario = "rounded-lg border border-finbra-purple px-4 py-2 text-sm font-semibold text-finbra-purple hover:bg-finbra-purple/5";

const MOTIVO = { numero_cliente: "por número de cliente", hubspot: "por ID de HubSpot", nombre: "por nombre" } as const;

function Destino({ p }: { p: PlanEmpresa }) {
  if (p.destino.tipo === "nueva") return <span className="rounded-full bg-finbra-purple/10 px-2 py-0.5 text-xs font-semibold text-finbra-purple-700">Empresa nueva</span>;
  if (p.destino.tipo === "error") return <span className="text-xs text-red-700">{p.destino.error}</span>;
  return (
    <span className="text-xs">
      <span className="rounded-full bg-emerald-100 px-2 py-0.5 font-semibold text-emerald-800">Se liga</span>{" "}
      a <strong>{p.destino.nombre}</strong> <span className="text-finbra-gray">({MOTIVO[p.destino.motivo]})</span>
    </span>
  );
}

export default function ImportarHubspotPanel() {
  const [contenido, setContenido] = useState("");
  const [archivo, setArchivo] = useState<string | null>(null);
  const [plan, setPlan] = useState<PlanEmpresa[] | null>(null);
  const [errores, setErrores] = useState<{ fila: number; error: string }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [hecho, setHecho] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const reiniciar = () => {
    setPlan(null);
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
        setErrores(r.errores);
      } else setError(r.error);
    });

  const importar = () =>
    start(async () => {
      const r = await importarHubspotAction(contenido);
      if (r.ok) {
        setHecho(r.mensaje);
        setPlan(null);
        setErrores([]);
        setContenido("");
        setArchivo(null);
      } else setError(r.error);
    });

  const validas = plan?.filter((p) => p.destino.tipo !== "error") ?? [];
  const negocios = validas.reduce((s, p) => s + p.negocios.length, 0);
  const nuevas = validas.filter((p) => p.destino.tipo === "nueva").length;

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
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm">
              <strong>{negocios}</strong> negocios de <strong>{validas.length}</strong> empresas ({nuevas} nuevas, {validas.length - nuevas} ligadas a clientes que ya existen)
              {plan.length - validas.length > 0 && <> · {plan.length - validas.length} empresas con error (se omiten)</>}
              {errores.length > 0 && <> · {errores.length} filas con error (se omiten)</>}
            </p>
            <button
              type="button"
              onClick={() => {
                if (window.confirm(`¿Importar ${negocios} negocios de ${validas.length} empresas?`)) importar();
              }}
              disabled={pending || negocios === 0}
              className={boton}
            >
              {pending ? "Importando…" : "Importar"}
            </button>
          </div>

          {errores.length > 0 && (
            <ul className="space-y-1 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
              {errores.map((e) => (
                <li key={e.fila}>Fila {e.fila}: {e.error}</li>
              ))}
            </ul>
          )}

          <div className="overflow-x-auto rounded-xl border border-black/5 bg-white">
            <table className="w-full min-w-[960px] text-left text-sm">
              <thead>
                <tr className="border-b border-black/5 text-xs uppercase tracking-wide text-finbra-gray">
                  <th className="px-4 py-2">Empresa</th>
                  <th className="px-4 py-2">Negocios</th>
                  <th className="px-4 py-2 text-right">Monto (HubSpot)</th>
                  <th className="px-4 py-2">Cierres</th>
                  <th className="px-4 py-2">Qué pasa</th>
                </tr>
              </thead>
              <tbody>
                {plan.map((p) => (
                  <tr key={p.clave} className="border-b border-black/5 align-top last:border-0">
                    <td className="px-4 py-2 font-medium">{p.nombre}</td>
                    <td className="px-4 py-2 text-xs text-finbra-gray">
                      {p.negocios.map((n) => (
                        <span key={n.dealId} className="block">
                          {n.negocio}
                        </span>
                      ))}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums">{formatMoney(p.monto)}</td>
                    <td className="whitespace-nowrap px-4 py-2 text-xs">
                      {p.primerCierre === p.ultimoCierre ? formatFecha(p.ultimoCierre) : `${formatFecha(p.primerCierre)} – ${formatFecha(p.ultimoCierre)}`}
                    </td>
                    <td className="px-4 py-2"><Destino p={p} /></td>
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
