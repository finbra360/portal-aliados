// Importar a Originación los negocios de HubSpot (fase O7), desde el export
// de negocios de HubSpot (CSV): los abiertos y, si se marcan, también los
// cerrados (Seguimiento a futuro → Pospuesto, Rechazados → Rechazado y
// ganados → Dispersado, con su fecha de cierre). Se importan solo los que el
// equipo marque. Cada negocio guarda su ID de HubSpot
// (origen_ref 'hubspot:<id>'), así que subir el export otra vez no duplica.
// Funciones puras, sin base de datos, para probarlas con `node --test`.

import { leerMonto, type EtapaNegocio, type OrigenNegocio, type TipoNegocio } from "./negocios.ts";
import { palabrasDe } from "./siac-liga.ts";

/** Texto sin acentos, en minúsculas y con espacios sencillos. */
export const normal = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

/** CSV (RFC 4180): comillas, comas o punto y coma, renglones dentro de comillas y BOM. */
export function leerCsv(texto: string): string[][] {
  const t = texto.replace(/^﻿/, "");
  const primera = t.slice(0, t.search(/\r?\n/) === -1 ? t.length : t.search(/\r?\n/));
  // Coma (CSV), punto y coma (Excel en español) o tabulador (celdas pegadas desde Excel o Sheets).
  const cuantos = (c: string) => primera.split(c).length - 1;
  const sep = [",", ";", "\t"].reduce((a, b) => (cuantos(b) > cuantos(a) ? b : a));
  const filas: string[][] = [];
  let fila: string[] = [];
  let campo = "";
  let comillas = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (comillas) {
      if (c === '"' && t[i + 1] === '"') {
        campo += '"';
        i++;
      } else if (c === '"') comillas = false;
      else campo += c;
    } else if (c === '"') comillas = true;
    else if (c === sep) {
      fila.push(campo);
      campo = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && t[i + 1] === "\n") i++;
      fila.push(campo);
      if (fila.some((x) => x.trim())) filas.push(fila);
      fila = [];
      campo = "";
    } else campo += c;
  }
  fila.push(campo);
  if (fila.some((x) => x.trim())) filas.push(fila);
  return filas;
}

/** Nombres de columna del export (español o inglés), ya normalizados. */
const COLUMNAS = {
  id: ["id de registro", "record id", "id del registro", "id del negocio", "deal id"],
  nombre: ["nombre del negocio", "deal name"],
  etapa: ["etapa del negocio", "deal stage", "etapa"],
  pipeline: ["pipeline", "canal de ventas"],
  monto: ["valor", "amount", "importe", "monto"],
  creado: ["fecha de creacion", "create date", "created date"],
  actividad: ["ultima actividad", "fecha de la ultima actividad", "last activity date", "last activity"],
  propietario: ["propietario del negocio", "deal owner", "propietario"],
  origen: ["origen"],
  cierre: ["fecha de cierre", "close date"],
  motivoPerdida: ["motivo de perdida", "motivo de perdida del negocio", "motivo de perdida de negocio cerrado", "motivo de cierre perdido", "closed lost reason"],
} as const;
type Columna = keyof typeof COLUMNAS;

/** La columna de la empresa asociada (su nombre, no su ID), si el export la trae. */
export const esColumnaEmpresa = (h: string) => /^(empresa|empresas) asociada|^associated compan/.test(h) && !/\bid\b|\bids\b/.test(h);

export interface FilaHubspot {
  hubspotId: string;
  nombre: string;
  /** Empresa asociada; si el export no la trae, el nombre del negocio. */
  empresa: string;
  etapaHubspot: string;
  pipeline: string;
  monto: number | null;
  /** YYYY-MM-DD */
  creadoEl: string | null;
  /** YYYY-MM-DD */
  ultimaActividad: string | null;
  propietario: string | null;
  origenHubspot: string | null;
  /** YYYY-MM-DD */
  cerradoEl: string | null;
  motivoPerdida: string | null;
}

/** Fecha del export: «2025-07-14», «2025-07-14 10:32», ISO o «14/07/2025». */
export function leerFecha(v: string | undefined): string | null {
  const t = (v ?? "").trim();
  let m = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  return null;
}

export type LecturaExport = { ok: true; filas: FilaHubspot[]; sinEmpresa: boolean } | { ok: false; error: string };

/** Lee el export de negocios de HubSpot. Pide al menos ID, nombre, etapa y pipeline. */
export function leerExport(texto: string): LecturaExport {
  const filas = leerCsv(texto);
  if (filas.length < 2) return { ok: false, error: "El archivo no trae negocios. Exporta los negocios de HubSpot en formato CSV." };
  const encabezado = filas[0].map(normal);
  const indice = {} as Record<Columna, number>;
  for (const [col, nombres] of Object.entries(COLUMNAS) as [Columna, readonly string[]][]) {
    indice[col] = encabezado.findIndex((h) => nombres.includes(h));
  }
  // El motivo de pérdida cambia de nombre según el idioma de HubSpot.
  if (indice.motivoPerdida < 0) indice.motivoPerdida = encabezado.findIndex((h) => /motivo.*perdid|closed lost reason/.test(h));
  const faltan = (["id", "nombre", "etapa", "pipeline"] as Columna[]).filter((c) => indice[c] < 0);
  if (faltan.length) {
    const nombres: Record<string, string> = { id: "ID de registro", nombre: "Nombre del negocio", etapa: "Etapa del negocio", pipeline: "Pipeline" };
    return { ok: false, error: `Al archivo le faltan columnas: ${faltan.map((c) => `«${nombres[c]}»`).join(", ")}. Expórtalo desde Negocios con todas las propiedades.` };
  }
  const iEmpresa = encabezado.findIndex(esColumnaEmpresa);
  const valor = (f: string[], col: Columna) => (indice[col] >= 0 ? (f[indice[col]] ?? "").trim() : "");
  const r: FilaHubspot[] = [];
  for (const f of filas.slice(1)) {
    const hubspotId = valor(f, "id");
    if (!/^\d{1,20}$/.test(hubspotId)) continue;
    const nombre = valor(f, "nombre").slice(0, 200);
    const empresa = (iEmpresa >= 0 ? (f[iEmpresa] ?? "").split(";")[0].trim() : "") || nombre;
    const monto = leerMonto(valor(f, "monto"));
    r.push({
      hubspotId,
      nombre,
      empresa: empresa.slice(0, 200),
      etapaHubspot: valor(f, "etapa"),
      pipeline: valor(f, "pipeline"),
      monto: monto === "invalido" ? null : monto,
      creadoEl: leerFecha(valor(f, "creado")),
      ultimaActividad: leerFecha(valor(f, "actividad")),
      propietario: valor(f, "propietario") || null,
      origenHubspot: valor(f, "origen") || null,
      cerradoEl: leerFecha(valor(f, "cierre")),
      motivoPerdida: valor(f, "motivoPerdida").slice(0, 500) || null,
    });
  }
  if (r.length === 0) return { ok: false, error: "No encontramos negocios con ID de HubSpot en el archivo." };
  return { ok: true, filas: r, sinEmpresa: iEmpresa < 0 };
}

/**
 * Etapas de HubSpot (etiqueta o ID interno) → etapa del negocio. Las cerradas:
 * Seguimiento a futuro → Pospuesto, Rechazados → Rechazado, ganados →
 * Dispersado. «Relación comercial» no es un crédito y no se trae («excluido»).
 */
const ETAPAS: Record<string, EtapaNegocio | "excluido"> = {
  "cliente potencial": "prospecto",
  appointmentscheduled: "prospecto",
  oportunidad: "calificado",
  qualifiedtobuy: "calificado",
  cotizacion: "calificado",
  presentationscheduled: "calificado",
  "solicitud de credito": "solicitud",
  decisionmakerboughtin: "solicitud",
  "1320005249": "solicitud",
  "analisis de riesgo": "analisis",
  "104647177": "analisis",
  "1320005251": "analisis",
  "visita domiciliaria": "analisis",
  "103420270": "analisis",
  "llamada con jose": "analisis",
  "1320005252": "analisis",
  "oferta comercial": "oferta",
  "103420269": "oferta",
  "1320005253": "oferta",
  "armado de expediente": "expediente",
  contractsent: "expediente",
  "1320005250": "expediente",
  "comite de credito": "comite",
  "206646661": "comite",
  "1353451876": "comite",
  "instrumentacion y contrato": "formalizacion",
  "216664739": "formalizacion",
  "1320005255": "formalizacion",
  "instalacion gps": "formalizacion",
  "103420271": "formalizacion",
  "instalacion gps/mediacion": "formalizacion",
  "1320005254": "formalizacion",
  "contrato ganado": "dispersado",
  closedwon: "dispersado",
  "1320560986": "dispersado",
  "contrato ganado leasing": "dispersado",
  "221384631": "dispersado",
  "relacion comercial": "excluido",
  "103420272": "excluido",
  "seguimiento a futuro": "pospuesto",
  closedlost: "pospuesto",
  "1320560987": "pospuesto",
  rechazados: "rechazado",
  "1192883721": "rechazado",
  "1320560988": "rechazado",
};

export const etapaDesdeHubspot = (etapa: string): EtapaNegocio | "excluido" | null => ETAPAS[normal(etapa)] ?? null;

/** Para las pestañas de la vista previa. */
export type GrupoImportacion = "abierto" | "seguimiento" | "rechazado" | "ganado";
export const GRUPOS: Record<GrupoImportacion, string> = {
  abierto: "Abiertos",
  seguimiento: "Seguimiento a futuro",
  rechazado: "Rechazados",
  ganado: "Ganados",
};
export const grupoDe = (etapa: EtapaNegocio): GrupoImportacion =>
  etapa === "pospuesto" ? "seguimiento" : etapa === "rechazado" ? "rechazado" : etapa === "dispersado" ? "ganado" : "abierto";

const ORIGENES: Record<string, OrigenNegocio> = {
  broker: "broker",
  outbound: "outbound",
  marketing: "marketing",
  "pagina web": "web",
  web: "web",
  pymio: "pymio",
  referido: "referido",
};

/** El pipeline de Renovaciones entra como renovación; si no, el «Origen» de HubSpot (sin origen: «Otro»). */
export function origenDesdeHubspot(origen: string | null, pipeline: string): { origen: OrigenNegocio; tipo: TipoNegocio } {
  if (/renov/.test(normal(pipeline)) || pipeline.trim() === "878981789") return { origen: "renovacion", tipo: "renovacion" };
  return { origen: ORIGENES[normal(origen ?? "")] ?? "manual", tipo: "nuevo" };
}

/** Días sin actividad para que un negocio ya no se marque solo al importar. */
export const DIAS_ACTIVO = 180;

export interface ParaImportar {
  fila: FilaHubspot;
  etapa: EtapaNegocio | null;
  grupo: GrupoImportacion;
  origen: OrigenNegocio;
  tipo: TipoNegocio;
  /** Empresa de Clientes con el mismo nombre; null = se crea como prospecto. */
  empresa: { id: string; nombre: string } | null;
  /** Usuario del backoffice que es el dueño en HubSpot; null = queda quien importa. */
  responsable: { email: string; nombre: string } | null;
  yaImportado: boolean;
  /** Se marca solo: abierto, con actividad en los últimos DIAS_ACTIVO días y sin importar todavía. Los cerrados nunca. */
  marcado: boolean;
  /** Por qué no se puede importar (etapa que no conocemos). */
  problema: string | null;
}

export const mismoNombre = (a: string, b: string) => {
  const x = [...palabrasDe(a)].sort().join(" ");
  return x !== "" && x === [...palabrasDe(b)].sort().join(" ");
};

/**
 * La vista previa: abiertos y cerrados (menos «Relación comercial»), con
 * su etapa, origen, empresa y responsable. La empresa se reconoce por nombre
 * (las mismas palabras, sin tipo de sociedad); el responsable, por correo o
 * por nombre.
 */
export function planImportacion(
  filas: FilaHubspot[],
  ctx: { hoy: string; importados: Set<string>; empresas: { id: string; nombre: string; razonSocial: string | null }[]; usuarios: { email: string; nombre: string }[] },
): ParaImportar[] {
  const limite = new Date(Date.parse(`${ctx.hoy}T12:00:00Z`) - DIAS_ACTIVO * 86_400_000).toISOString().slice(0, 10);
  const r: ParaImportar[] = [];
  for (const fila of filas) {
    const etapa = etapaDesdeHubspot(fila.etapaHubspot);
    if (etapa === "excluido") continue;
    const grupo = etapa ? grupoDe(etapa) : "abierto";
    const { origen, tipo } = origenDesdeHubspot(fila.origenHubspot, fila.pipeline);
    const e = ctx.empresas.find((x) => mismoNombre(x.nombre, fila.empresa) || (x.razonSocial !== null && mismoNombre(x.razonSocial, fila.empresa)));
    const p = normal(fila.propietario ?? "");
    const u = p ? ctx.usuarios.find((x) => p.includes(x.email.toLowerCase()) || normal(x.nombre) === p) : undefined;
    const yaImportado = ctx.importados.has(fila.hubspotId);
    const problema = etapa === null ? `No conocemos la etapa «${fila.etapaHubspot || "vacía"}».` : null;
    r.push({
      fila,
      etapa,
      grupo,
      origen,
      // Una empresa que no está en Clientes entra como prospecto: su negocio es un crédito nuevo.
      tipo: e ? tipo : "nuevo",
      empresa: e ? { id: e.id, nombre: e.nombre } : null,
      responsable: u ? { email: u.email, nombre: u.nombre } : null,
      yaImportado,
      marcado: grupo === "abierto" && !yaImportado && !problema && !!fila.ultimaActividad && fila.ultimaActividad >= limite,
      problema,
    });
  }
  return r.sort((a, b) => Number(b.marcado) - Number(a.marcado) || (b.fila.ultimaActividad ?? "").localeCompare(a.fila.ultimaActividad ?? "") || a.fila.nombre.localeCompare(b.fila.nombre));
}

/** Encabezados normalizados de las columnas que usa el importador (para compactar el export). */
function columnasUtiles(encabezado: string[]): number[] {
  const todas = Object.values(COLUMNAS).flat() as string[];
  return encabezado
    .map((h, i) => (todas.includes(h) || esColumnaEmpresa(h) || /motivo.*perdid|closed lost reason/.test(h) ? i : -1))
    .filter((i) => i >= 0);
}

export const comillas = (v: string) => (/[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

/**
 * El export con solo las columnas que se usan, para mandarlo al servidor:
 * un export «con todas las propiedades» puede pasar de 1 MB. Si no trae las
 * columnas mínimas, regresa el texto tal cual (el servidor dirá qué falta).
 */
export function compactarExport(texto: string): string {
  const filas = leerCsv(texto);
  if (filas.length < 2) return texto;
  const encabezado = filas[0].map(normal);
  const usar = columnasUtiles(encabezado);
  if (usar.length < 4) return texto;
  return filas.map((f) => usar.map((i) => comillas(f[i] ?? "")).join(",")).join("\n");
}
