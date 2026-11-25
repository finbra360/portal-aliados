"use client";

// Importar contactos de HubSpot: se elige (o arrastra, o pega) el export de
// contactos, se ve cada contacto con la empresa de Clientes que le toca, y se
// importan los marcados en tandas. Los que ya están en su empresa o cuya
// empresa no está en Clientes no se pueden marcar.

import { useState, useTransition } from "react";
import Link from "next/link";
import { compactarContactos, type ContactoParaImportar } from "@/lib/clientes/hubspot-contactos";
import { importarContactosAction, vistaPreviaContactosAction } from "../actions";
import { leerArchivo } from "../../brokers/importar/ImportarPanel";

const boton = "rounded-lg bg-finbra-purple px-4 py-2 text-sm font-semibold text-white hover:bg-finbra-purple/90 disabled:opacity-50";
const secundario = "rounded-lg border border-black/10 px-3 py-1.5 text-sm hover:bg-black/5 disabled:opacity-50";
const pestana = (activa: boolean) =>
  `rounded-full px-3 py-1 text-sm font-medium ${activa ? "bg-finbra-purple text-white" : "bg-black/5 text-finbra-gray hover:bg-black/10"}`;
const TANDA = 40;

type Grupo = "importar" | "existen" | "sinEmpresa";
const GRUPOS: Record<Grupo, string> = { importar: "Para importar", existen: "Ya están", sinEmpresa: "Sin empresa en Clientes" };
const grupoDe = (x: ContactoParaImportar): Grupo => (x.problema ? "sinEmpresa" : x.yaExiste ? "existen" : "importar");
type Resultado = { creados: number; canales: number; yaEstaban: number; sinEmpresa: number };

const telefono = (t: string) => `${t.slice(0, 2)} ${t.slice(2, 6)} ${t.slice(6)}`;

export default function ImportarContactos() {
  const [texto, setTexto] = useState<string | null>(null);
  const [archivo, setArchivo] = useState("");
  const [items, setItems] = useState<ContactoParaImportar[] | null>(null);
  const [elegidos, setElegidos] = useState<Set<string>>(new Set());
  const [grupo, setGrupo] = useState<Grupo>("importar");
  const [error, setError] = useState<string | null>(null);
  const [resultado, setResultado] = useState<Resultado | null>(null);
  const [avance, setAvance] = useState<string | null>(null);
  const [pegado, setPegado] = useState("");
  const [arrastrando, setArrastrando] = useState(false);
  const [pendiente, start] = useTransition();

  const delGrupo = (items ?? []).filter((x) => grupoDe(x) === grupo);
  const cuantos = (g: Grupo) => (items ?? []).filter((x) => grupoDe(x) === g).length;
  const importables = (items ?? []).filter((x) => grupoDe(x) === "importar");

  function previsualizar(t: string, conservar = false) {
    start(async () => {
      const r = await vistaPreviaContactosAction(t);
      if (!r.ok) {
        setError(r.error);
        setItems(null);
        return;
      }
      setError(null);
      setItems(r.items);
      setElegidos(conservar ? new Set() : new Set(r.items.filter((x) => x.marcado).map((x) => x.fila.hubspotId)));
    });
  }

  async function elegirArchivo(f: File | undefined) {
    setResultado(null);
    setError(null);
    if (!f) return;
    if (/\.xlsx?$/i.test(f.name)) return setError("Ese archivo es de Excel. En HubSpot exporta en formato CSV, o copia las celdas y pégalas abajo.");
    if (/\.zip$/i.test(f.name)) return setError("HubSpot lo mandó comprimido (.zip). Ábrelo y sube el CSV de contactos que viene adentro.");
    if (f.size > 30_000_000) return setError("El archivo es demasiado grande. Exporta solo los contactos, sin actividades.");
    const t = compactarContactos(await leerArchivo(f));
    if (t.length > 900_000) return setError("El archivo es demasiado grande aun quitando las columnas que no se usan.");
    setArchivo(f.name);
    setTexto(t);
    previsualizar(t);
  }

  function revisarPegado() {
    setResultado(null);
    setError(null);
    if (!pegado.trim()) return;
    const t = compactarContactos(pegado);
    setArchivo("Celdas pegadas");
    setTexto(t);
    previsualizar(t);
  }

  function importar() {
    if (!texto || elegidos.size === 0) return;
    if (!window.confirm(`¿Importar ${elegidos.size} ${elegidos.size === 1 ? "contacto" : "contactos"} de HubSpot a sus empresas?`)) return;
    const ids = [...elegidos];
    start(async () => {
      const total: Resultado = { creados: 0, canales: 0, yaEstaban: 0, sinEmpresa: 0 };
      for (let i = 0; i < ids.length; i += TANDA) {
        setAvance(`Importando ${Math.min(i + TANDA, ids.length)} de ${ids.length}…`);
        const r = await importarContactosAction(texto, ids.slice(i, i + TANDA));
        if (!r.ok) {
          setError(`${r.error} Alcanzaron a entrar ${total.creados}.`);
          break;
        }
        total.creados += r.r.creados;
        total.canales += r.r.canales;
        total.yaEstaban += r.r.yaEstaban;
        total.sinEmpresa += r.r.sinEmpresa;
      }
      setAvance(null);
      setResultado(total);
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
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setArrastrando(true);
        }}
        onDragLeave={() => setArrastrando(false)}
        onDrop={(e) => {
          e.preventDefault();
          setArrastrando(false);
          elegirArchivo(e.dataTransfer.files?.[0]);
        }}
        className={`space-y-3 rounded-xl border-2 border-dashed p-6 text-center ${arrastrando ? "border-finbra-purple bg-finbra-purple/5" : "border-black/10"}`}
      >
        <p className="text-sm font-medium">Arrastra aquí el export de contactos de HubSpot</p>
        <label className={`${boton} inline-block cursor-pointer`}>
          Elegir archivo
          <input
            id="archivoContactos"
            type="file"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              elegirArchivo(f);
            }}
            className="sr-only"
          />
        </label>
        <p className="text-xs text-finbra-gray">
          En HubSpot: Contactos → Exportar → formato <span className="font-semibold">CSV</span>, con todas las propiedades (necesita el nombre de la empresa o la empresa asociada).
        </p>
        {archivo && <p className="text-xs text-finbra-gray">Archivo: {archivo}</p>}
      </div>

      <details className="rounded-lg border border-black/5 px-4 py-3 text-sm">
        <summary className="cursor-pointer font-medium">¿No puedes subir el archivo? Pega las celdas</summary>
        <div className="mt-3 space-y-2">
          <textarea
            value={pegado}
            onChange={(e) => setPegado(e.target.value)}
            rows={6}
            spellCheck={false}
            aria-label="Celdas copiadas del export de contactos"
            className="w-full rounded-lg border border-black/10 bg-white px-3 py-2 font-mono text-xs"
          />
          <button type="button" onClick={revisarPegado} disabled={pendiente || !pegado.trim()} className={secundario}>
            Revisar lo pegado
          </button>
        </div>
      </details>

      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">{error}</p>}
      {resultado && (
        <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800" role="status">
          Listo: {resultado.creados} {resultado.creados === 1 ? "contacto nuevo" : "contactos nuevos"} con {resultado.canales}{" "}
          {resultado.canales === 1 ? "teléfono o correo" : "teléfonos y correos"}
          {resultado.yaEstaban ? `; ${resultado.yaEstaban} ya estaban` : ""}
          {resultado.sinEmpresa ? `; ${resultado.sinEmpresa} sin empresa` : ""}.
        </p>
      )}
      {pendiente && <p className="text-sm text-finbra-gray" role="status">{avance ?? "Leyendo…"}</p>}

      {items && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap gap-2" role="tablist" aria-label="Qué contactos ver">
              {(Object.keys(GRUPOS) as Grupo[]).map((g) => (
                <button key={g} type="button" role="tab" aria-selected={grupo === g} onClick={() => setGrupo(g)} className={pestana(grupo === g)}>
                  {GRUPOS[g]} ({cuantos(g)})
                </button>
              ))}
            </div>
            {grupo === "importar" && (
              <div className="flex flex-wrap gap-2">
                <button type="button" className={secundario} onClick={() => setElegidos(new Set(importables.map((x) => x.fila.hubspotId)))}>
                  Todos
                </button>
                <button type="button" className={secundario} onClick={() => setElegidos(new Set(importables.filter((x) => x.marcado).map((x) => x.fila.hubspotId)))}>
                  Solo con teléfono o correo
                </button>
                <button type="button" className={secundario} onClick={() => setElegidos(new Set())}>
                  Ninguno
                </button>
              </div>
            )}
          </div>
          {grupo === "sinEmpresa" && cuantos("sinEmpresa") > 0 && (
            <p className="rounded-lg bg-black/5 px-3 py-2 text-sm text-finbra-gray">
              Su empresa no está en Clientes con el mismo nombre. Si es una empresa que sí tienes, revisa que se llame igual (o júntala en{" "}
              <Link href="/backoffice/clientes/revisar" className="font-semibold text-finbra-purple hover:underline">Empresas por revisar</Link>) y vuelve a subir el archivo.
            </p>
          )}
          <div className="overflow-x-auto rounded-lg border border-black/5">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead>
                <tr className="border-b border-black/5 text-xs uppercase tracking-wide text-finbra-gray">
                  <th scope="col" className="px-3 py-2"><span className="sr-only">Importar</span></th>
                  <th scope="col" className="px-3 py-2">Contacto</th>
                  <th scope="col" className="px-3 py-2">Empresa</th>
                  <th scope="col" className="px-3 py-2">Teléfonos</th>
                  <th scope="col" className="px-3 py-2">Correo</th>
                </tr>
              </thead>
              <tbody>
                {delGrupo.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-3 py-6 text-center text-finbra-gray">Nada en esta lista.</td>
                  </tr>
                ) : (
                  delGrupo.map((x) => {
                    const f = x.fila;
                    const bloqueado = grupo !== "importar";
                    return (
                      <tr key={f.hubspotId} className={`border-b border-black/5 last:border-0 ${bloqueado ? "text-finbra-gray" : ""}`}>
                        <td className="px-3 py-2 align-top">
                          <input
                            type="checkbox"
                            aria-label={`Importar ${f.nombre || f.hubspotId}`}
                            checked={elegidos.has(f.hubspotId)}
                            disabled={bloqueado}
                            onChange={(e) => cambiar(f.hubspotId, e.target.checked)}
                          />
                        </td>
                        <td className="px-3 py-2 align-top">
                          <p className="font-medium">{f.nombre || "—"}</p>
                          {f.puesto && <p className="text-xs text-finbra-gray">{f.puesto}</p>}
                        </td>
                        <td className="px-3 py-2 align-top">
                          {x.empresa ? (
                            <Link href={`/backoffice/clientes/${x.empresa.id}?tab=contactos`} className="hover:text-finbra-purple hover:underline" target="_blank">
                              {x.empresa.nombre}
                            </Link>
                          ) : (
                            <span>{f.empresa ?? "—"}</span>
                          )}
                          {x.problema && <p className="text-xs text-red-700">{x.problema}</p>}
                          {x.yaExiste && <p className="text-xs text-emerald-700">Ya está en la empresa</p>}
                        </td>
                        <td className="px-3 py-2 align-top tabular-nums">{f.telefonos.length ? f.telefonos.map(telefono).join(", ") : "—"}</td>
                        <td className="px-3 py-2 align-top">{f.correo ?? "—"}</td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" onClick={importar} disabled={pendiente || elegidos.size === 0} className={boton}>
              {pendiente && avance ? "Importando…" : `Importar ${elegidos.size} ${elegidos.size === 1 ? "contacto" : "contactos"}`}
            </button>
            <p className="text-xs text-finbra-gray">
              Si la empresa no tiene contacto principal, el primero que entra queda como principal. En un cliente de SIAC, sus teléfonos y correo quedan en el
              expediente de cobranza pero no reciben recordatorios.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
