"use client";

// Importar de HubSpot: se elige el export (CSV), se ve la vista previa con una
// casilla por negocio, en pestañas (abiertos, seguimiento a futuro, rechazados
// y ganados), y se importan los marcados, en tandas para no pasar el tiempo
// del servidor. El archivo se lee en el navegador y se manda como texto; el
// servidor lo vuelve a leer en cada tanda.

import { useState, useTransition } from "react";
import Link from "next/link";
import { ETIQUETA_ETAPA, ORIGENES_NEGOCIO } from "@/lib/clientes/negocios";
import { GRUPOS, compactarExport, type ColumnaFaltante, type GrupoImportacion, type ParaImportar } from "@/lib/clientes/hubspot-import";
import { formatFecha, formatMoney } from "@/lib/format";
import { importarHubspotAction, vistaPreviaHubspotAction } from "../actions";
import { leerArchivo } from "../../brokers/importar/ImportarPanel";

/** Lo que conviene decir si el archivo no es un CSV. */
function errorDeTipo(nombre: string): string | null {
  if (/\.xlsx?$/i.test(nombre)) {
    return "Ese archivo es de Excel. En HubSpot vuelve a exportar y elige el formato CSV, o abre el Excel, copia todas las celdas (con los encabezados) y pégalas abajo.";
  }
  if (/\.zip$/i.test(nombre)) return "HubSpot lo mandó comprimido (.zip). Ábrelo y sube el archivo CSV de negocios que viene adentro.";
  return null;
}

const boton = "rounded-lg bg-finbra-purple px-4 py-2 text-sm font-semibold text-white hover:bg-finbra-purple/90 disabled:opacity-50";
const secundario = "rounded-lg border border-black/10 px-3 py-1.5 text-sm hover:bg-black/5";

type Resultado = { creados: number; empresasNuevas: number; yaEstaban: number; conProblema: number };

/** Negocios por tanda: cada una es una llamada al servidor. */
const TANDA = 40;

const pestana = (activa: boolean) =>
  `rounded-full px-3 py-1 text-sm font-medium ${activa ? "bg-finbra-purple text-white" : "bg-black/5 text-finbra-gray hover:bg-black/10"}`;

/** Columnas importantes que el export no trae: qué pasa si se importa así y cómo traerlas. */
function AvisoColumnas({ faltan }: { faltan: ColumnaFaltante[] }) {
  return (
    <div className="space-y-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900" role="alert">
      <p className="font-semibold">
        Al archivo le {faltan.length === 1 ? "falta una columna" : `faltan ${faltan.length} columnas`}. Si lo importas así:
      </p>
      <ul className="list-disc space-y-1 pl-5">
        {faltan.map((x) => (
          <li key={x.columna}>
            Sin <span className="font-semibold">«{x.columna}»</span>, {x.efecto}.
          </li>
        ))}
      </ul>
      <p>
        Para traerlas, en HubSpot ve a Negocios, agrega esas columnas a la vista (o elige «Exportar todas las propiedades») y vuelve a exportar antes de importar: lo que ya
        importaste no se duplica, pero tampoco se corrige al subirlo otra vez.
      </p>
    </div>
  );
}

export default function ImportarHubspot() {
  const [texto, setTexto] = useState<string | null>(null);
  const [archivo, setArchivo] = useState("");
  const [items, setItems] = useState<ParaImportar[] | null>(null);
  const [info, setInfo] = useState<{ faltan: ColumnaFaltante[]; excluidos: number } | null>(null);
  const [grupo, setGrupo] = useState<GrupoImportacion>("abierto");
  const [avance, setAvance] = useState<string | null>(null);
  const [elegidos, setElegidos] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [resultado, setResultado] = useState<Resultado | null>(null);
  const [pendiente, startTransition] = useTransition();
  const [pegado, setPegado] = useState("");
  const [arrastrando, setArrastrando] = useState(false);

  const disponibles = (items ?? []).filter((x) => !x.yaImportado && !x.problema);
  const delGrupo = (items ?? []).filter((x) => x.grupo === grupo);
  const disponiblesDelGrupo = disponibles.filter((x) => x.grupo === grupo);
  const cuantos = (g: GrupoImportacion) => (items ?? []).filter((x) => x.grupo === g).length;
  const marcadosEn = (g: GrupoImportacion) => (items ?? []).filter((x) => x.grupo === g && elegidos.has(x.fila.hubspotId)).length;
  const marcarGrupo = (si: boolean) =>
    setElegidos((s) => {
      const n = new Set(s);
      for (const x of disponiblesDelGrupo) {
        if (si) n.add(x.fila.hubspotId);
        else n.delete(x.fila.hubspotId);
      }
      return n;
    });

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
      setInfo({ faltan: r.faltan, excluidos: r.excluidos });
      if (!conservar) setElegidos(new Set(r.items.filter((x) => x.marcado).map((x) => x.fila.hubspotId)));
      else setElegidos(new Set());
    });
  }

  async function elegirArchivo(f: File | undefined) {
    setResultado(null);
    setError(null);
    if (!f) return;
    const tipo = errorDeTipo(f.name);
    if (tipo) {
      setError(tipo);
      return;
    }
    if (f.size > 30_000_000) {
      setError("El archivo es demasiado grande. Exporta solo los negocios (sin actividades ni notas).");
      return;
    }
    // Al servidor solo van las columnas que se usan: un export con todas las propiedades puede pasar de 1 MB.
    const t = compactarExport(await leerArchivo(f));
    if (t.length > 900_000) {
      setError("El archivo es demasiado grande aun quitando las columnas que no se usan. Exporta solo los negocios, sin actividades ni notas.");
      return;
    }
    setArchivo(f.name);
    setTexto(t);
    previsualizar(t);
  }

  function revisarPegado() {
    setResultado(null);
    setError(null);
    if (!pegado.trim()) return;
    const t = compactarExport(pegado);
    setArchivo("Celdas pegadas");
    setTexto(t);
    previsualizar(t);
  }

  function importar() {
    if (!texto || elegidos.size === 0) return;
    const porGrupo = (Object.keys(GRUPOS) as GrupoImportacion[])
      .map((g) => [GRUPOS[g], marcadosEn(g)] as const)
      .filter(([, n]) => n > 0)
      .map(([g, n]) => `${n} ${g.toLowerCase()}`)
      .join(", ");
    const sinColumnas = info?.faltan.length ? `

Ojo: al archivo le faltan ${info.faltan.map((x) => `«${x.columna}»`).join(", ")}.` : "";
    if (!window.confirm(`¿Importar ${elegidos.size} ${elegidos.size === 1 ? "negocio" : "negocios"} de HubSpot (${porGrupo})?${sinColumnas}`)) return;
    const ids = [...elegidos];
    startTransition(async () => {
      const total: Resultado = { creados: 0, empresasNuevas: 0, yaEstaban: 0, conProblema: 0 };
      for (let i = 0; i < ids.length; i += TANDA) {
        setAvance(`Importando ${Math.min(i + TANDA, ids.length)} de ${ids.length}…`);
        const r = await importarHubspotAction(texto, ids.slice(i, i + TANDA));
        if (!r.ok) {
          setError(`${r.error} Alcanzaron a entrar ${total.creados}.`);
          break;
        }
        total.creados += r.r.creados;
        total.empresasNuevas += r.r.empresasNuevas;
        total.yaEstaban += r.r.yaEstaban;
        total.conProblema += r.r.conProblema;
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
        <p className="text-sm font-medium">Arrastra aquí el export de negocios de HubSpot</p>
        <label className={`${boton} inline-block cursor-pointer`}>
          Elegir archivo
          {/* Sin filtro de tipo: si eligen un Excel o un .zip, se les dice qué hacer en vez de no dejarlos elegirlo. */}
          <input
            id="archivo"
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
          En HubSpot: Negocios → Exportar → formato <span className="font-semibold">CSV</span>, con todas las propiedades. Si te llega un .zip, sube el CSV que viene adentro.
        </p>
        {archivo && <p className="text-xs text-finbra-gray">Archivo: {archivo}</p>}
      </div>

      <details className="rounded-lg border border-black/5 px-4 py-3 text-sm">
        <summary className="cursor-pointer font-medium">¿No puedes subir el archivo? Pega las celdas</summary>
        <div className="mt-3 space-y-2">
          <p className="text-xs text-finbra-gray">Abre el export en Excel o Google Sheets, selecciona todo (con la fila de encabezados), copia y pega aquí.</p>
          <textarea
            value={pegado}
            onChange={(e) => setPegado(e.target.value)}
            rows={6}
            spellCheck={false}
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
          Listo: {resultado.creados} {resultado.creados === 1 ? "negocio importado" : "negocios importados"}
          {resultado.empresasNuevas ? `, ${resultado.empresasNuevas} ${resultado.empresasNuevas === 1 ? "empresa nueva como prospecto" : "empresas nuevas como prospecto"}` : ""}
          {resultado.yaEstaban ? `; ${resultado.yaEstaban} ya estaban` : ""}
          {resultado.conProblema ? `; ${resultado.conProblema} con problema (no entraron)` : ""}.{" "}
          <Link href="/backoffice/negocios" className="font-semibold underline">Ver los negocios</Link>
        </p>
      )}
      {pendiente && <p className="text-sm text-finbra-gray" role="status">{avance ?? "Leyendo…"}</p>}

      {items && info && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm">
              <span className="font-semibold">{archivo}</span>: {items.length} {items.length === 1 ? "negocio" : "negocios"}
              {info.excluidos > 0 && ` (${info.excluidos} de «Relación comercial» no se traen)`}.{" "}
              <span className="font-semibold">{elegidos.size} marcados en total.</span>
            </p>
          </div>
          {info.faltan.length > 0 && <AvisoColumnas faltan={info.faltan} />}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap gap-2" role="tablist" aria-label="Qué negocios ver">
              {(Object.keys(GRUPOS) as GrupoImportacion[]).map((g) => (
                <button key={g} type="button" role="tab" aria-selected={grupo === g} onClick={() => setGrupo(g)} className={pestana(grupo === g)}>
                  {GRUPOS[g]} ({cuantos(g)}){marcadosEn(g) > 0 && ` · ${marcadosEn(g)} marcados`}
                </button>
              ))}
            </div>
            <div className="flex flex-wrap gap-2">
              {grupo === "abierto" && (
                <button
                  type="button"
                  className={secundario}
                  onClick={() =>
                    setElegidos((s) => {
                      const n = new Set([...s].filter((id) => !disponiblesDelGrupo.some((x) => x.fila.hubspotId === id)));
                      for (const x of disponiblesDelGrupo) if (x.marcado) n.add(x.fila.hubspotId);
                      return n;
                    })
                  }
                >
                  Solo los activos
                </button>
              )}
              <button type="button" className={secundario} onClick={() => marcarGrupo(true)}>
                Todos los de esta lista
              </button>
              <button type="button" className={secundario} onClick={() => marcarGrupo(false)}>
                Ninguno de esta lista
              </button>
            </div>
          </div>
          {grupo !== "abierto" && (
            <p className="rounded-lg bg-black/5 px-3 py-2 text-sm text-finbra-gray">
              {grupo === "seguimiento"
                ? "Entran como Pospuesto, con su fecha de cierre de HubSpot y sin fecha para volver a contactarlos: no crean tareas."
                : grupo === "rechazado"
                  ? "Entran como Rechazado, con su fecha de cierre y el motivo de HubSpot si el export lo trae."
                  : "Entran como Dispersado, con su fecha de cierre. No crean colocaciones ni piden ligarse a SIAC en Inicio (solo los dispersados de los últimos 90 días lo piden)."}
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
                  <th scope="col" className="px-3 py-2">{grupo === "abierto" ? "Última actividad" : "Cerrado"}</th>
                </tr>
              </thead>
              <tbody>
                {delGrupo.map((x) => {
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
                      <td className="px-3 py-2 align-top">
                        {grupo === "abierto" ? (
                          f.ultimaActividad ? formatFecha(f.ultimaActividad) : <span className="text-finbra-gray">Nunca</span>
                        ) : f.cerradoEl ? (
                          formatFecha(f.cerradoEl)
                        ) : (
                          <span className="text-finbra-gray">Sin fecha</span>
                        )}
                        {f.motivoPerdida && <p className="text-xs text-finbra-gray">{f.motivoPerdida}</p>}
                      </td>
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
            <p className="text-xs text-finbra-gray">Se importan los marcados de todas las pestañas, en su etapa, con su monto y su fecha de alta de HubSpot. Si los vuelves a subir, no se duplican.</p>
          </div>
        </div>
      )}
    </div>
  );
}
