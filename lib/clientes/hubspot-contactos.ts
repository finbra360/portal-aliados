// Importar los contactos de HubSpot (nombre, puesto, teléfonos y correo) a las
// empresas de Clientes, desde el export de contactos de HubSpot (CSV). Cada
// contacto va a la empresa con el mismo nombre que su empresa asociada; si no
// hay una, no se importa. Un contacto que ya está en su empresa (mismo nombre,
// teléfono o correo) no se vuelve a crear. Funciones puras, sin base de datos,
// para probarlas con `node --test`.

import { comillas, esColumnaEmpresa, leerCsv, mismoNombre, normal } from "./hubspot-import.ts";
import { leerTelefono } from "./negocios.ts";

const COLUMNAS = {
  id: ["id de registro", "record id", "id del registro", "id del contacto", "contact id"],
  nombre: ["nombre", "first name", "nombre de pila"],
  apellidos: ["apellidos", "apellido", "last name"],
  correo: ["correo", "correo electronico", "email", "e-mail"],
  telefono: ["numero de telefono", "telefono", "phone number", "phone"],
  movil: ["numero de telefono movil", "telefono movil", "celular", "mobile phone number", "mobile phone"],
  puesto: ["cargo", "puesto", "puesto de trabajo", "titulo del puesto", "job title"],
  empresaTexto: ["nombre de la empresa", "empresa", "company name", "company"],
} as const;
type Columna = keyof typeof COLUMNAS;

export interface FilaContacto {
  hubspotId: string;
  nombre: string;
  puesto: string | null;
  /** En minúsculas y con forma de correo; null si no trae o no es válido. */
  correo: string | null;
  /** 10 dígitos, sin repetir. */
  telefonos: string[];
  /** Empresa asociada o, si no, la que escribieron en el contacto. */
  empresa: string | null;
}

const CORREO = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function indices(encabezado: string[]) {
  const ix = {} as Record<Columna, number>;
  for (const [col, nombres] of Object.entries(COLUMNAS) as [Columna, readonly string[]][]) ix[col] = encabezado.findIndex((h) => nombres.includes(h));
  return { ix, asociada: encabezado.findIndex(esColumnaEmpresa) };
}

export type LecturaContactos = { ok: true; filas: FilaContacto[] } | { ok: false; error: string };

/** Lee el export de contactos de HubSpot. Pide el ID y al menos el nombre o el correo. */
export function leerExportContactos(texto: string): LecturaContactos {
  const filas = leerCsv(texto);
  if (filas.length < 2) return { ok: false, error: "El archivo no trae contactos. Exporta los contactos de HubSpot en formato CSV." };
  const { ix, asociada } = indices(filas[0].map(normal));
  if (ix.id < 0) return { ok: false, error: "Al archivo le falta la columna «ID de registro». Exporta los contactos desde HubSpot con todas las propiedades." };
  if (ix.nombre < 0 && ix.apellidos < 0 && ix.correo < 0) return { ok: false, error: "El archivo no trae nombre ni correo. ¿Es el export de contactos? (el de negocios se sube en la otra pestaña)." };
  if (ix.empresaTexto < 0 && asociada < 0) return { ok: false, error: "El archivo no trae la empresa de cada contacto. Exporta con la propiedad «Nombre de la empresa» o la empresa asociada." };
  const v = (f: string[], col: Columna) => (ix[col] >= 0 ? (f[ix[col]] ?? "").trim() : "");
  const r: FilaContacto[] = [];
  for (const f of filas.slice(1)) {
    const hubspotId = v(f, "id");
    if (!/^\d{1,20}$/.test(hubspotId)) continue;
    const correoTexto = v(f, "correo").toLowerCase();
    const correo = CORREO.test(correoTexto) ? correoTexto.slice(0, 200) : null;
    const nombre = [v(f, "nombre"), v(f, "apellidos")].filter(Boolean).join(" ").replace(/\s+/g, " ").slice(0, 150) || (correo ? correo.split("@")[0] : "");
    const telefonos = [...new Set([v(f, "telefono"), v(f, "movil")].map((t) => leerTelefono(t)).filter((t): t is string => !!t && t !== "invalido"))];
    const empresa = ((asociada >= 0 ? (f[asociada] ?? "").split(";")[0].trim() : "") || v(f, "empresaTexto")).slice(0, 200) || null;
    r.push({ hubspotId, nombre, puesto: v(f, "puesto").slice(0, 120) || null, correo, telefonos, empresa });
  }
  if (r.length === 0) return { ok: false, error: "No encontramos contactos con ID de HubSpot en el archivo." };
  return { ok: true, filas: r };
}

/** Solo las columnas que se usan (un export con todas las propiedades puede pasar de 1 MB). */
export function compactarContactos(texto: string): string {
  const filas = leerCsv(texto);
  if (filas.length < 2) return texto;
  const encabezado = filas[0].map(normal);
  const todas = Object.values(COLUMNAS).flat() as string[];
  const usar = encabezado.map((h, i) => (todas.includes(h) || esColumnaEmpresa(h) ? i : -1)).filter((i) => i >= 0);
  if (usar.length < 2) return texto;
  return filas.map((f) => usar.map((i) => comillas(f[i] ?? "")).join(",")).join("\n");
}

export interface YaEnEmpresa {
  /** Nombres normalizados de las personas que ya tiene. */
  nombres: Set<string>;
  /** Teléfonos (10 dígitos) y correos (minúsculas) que ya tiene. */
  canales: Set<string>;
}

export interface ContactoParaImportar {
  fila: FilaContacto;
  empresa: { id: string; nombre: string } | null;
  yaExiste: boolean;
  /** Por qué no se puede importar. */
  problema: string | null;
  /** Se marca solo: tiene empresa, no existe y trae teléfono o correo. */
  marcado: boolean;
}

/**
 * La vista previa. La empresa se reconoce por nombre (las mismas palabras, sin
 * tipo de sociedad). Ya existe si en esa empresa hay una persona con el mismo
 * nombre o alguno de sus teléfonos o su correo.
 */
export function planContactos(
  filas: FilaContacto[],
  ctx: { empresas: { id: string; nombre: string; razonSocial: string | null }[]; existentes: Map<string, YaEnEmpresa> },
): ContactoParaImportar[] {
  const r: ContactoParaImportar[] = [];
  // Lo que ya se vio en el mismo archivo cuenta como existente (un contacto repetido en el export).
  const vistos = new Map<string, YaEnEmpresa>();
  for (const fila of filas) {
    const e = fila.empresa
      ? ctx.empresas.find((x) => mismoNombre(x.nombre, fila.empresa!) || (x.razonSocial !== null && mismoNombre(x.razonSocial, fila.empresa!)))
      : undefined;
    const coincide = (ya: YaEnEmpresa | undefined) =>
      !!ya && (ya.nombres.has(normal(fila.nombre)) || fila.telefonos.some((t) => ya.canales.has(t)) || (!!fila.correo && ya.canales.has(fila.correo)));
    const yaExiste = !!e && (coincide(ctx.existentes.get(e.id)) || coincide(vistos.get(e.id)));
    if (e && fila.nombre && !yaExiste) {
      const v = vistos.get(e.id) ?? { nombres: new Set<string>(), canales: new Set<string>() };
      v.nombres.add(normal(fila.nombre));
      for (const t of fila.telefonos) v.canales.add(t);
      if (fila.correo) v.canales.add(fila.correo);
      vistos.set(e.id, v);
    }
    const problema = !fila.nombre
      ? "No trae nombre ni correo."
      : !fila.empresa
        ? "No tiene empresa en HubSpot."
        : !e
          ? `«${fila.empresa}» no está en Clientes.`
          : null;
    r.push({
      fila,
      empresa: e ? { id: e.id, nombre: e.nombre } : null,
      yaExiste,
      problema,
      marcado: !problema && !yaExiste && (fila.telefonos.length > 0 || !!fila.correo),
    });
  }
  return r.sort(
    (a, b) =>
      Number(!!a.problema) - Number(!!b.problema) ||
      Number(b.marcado) - Number(a.marcado) ||
      (a.empresa?.nombre ?? a.fila.empresa ?? "").localeCompare(b.empresa?.nombre ?? b.fila.empresa ?? "") ||
      a.fila.nombre.localeCompare(b.fila.nombre),
  );
}
