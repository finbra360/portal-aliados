// Alta y carga masiva de brokers: leer el archivo (CSV o pegado desde Excel),
// reconocer columnas, validar y asignar IDs. Funciones puras, sin base de
// datos, para probarlas con `node --test`.

export interface BrokerNuevo {
  email: string;
  nombre: string;
  telefono: string | null;
}

export type ResultadoValidacion = ({ ok: true } & BrokerNuevo) | { ok: false; error: string };

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** 10 dígitos de México (acepta +52, espacios, guiones). null si viene vacío. */
export function normalizarTelefono(texto: string | null | undefined): { ok: true; telefono: string | null } | { ok: false } {
  const t = String(texto ?? "").trim();
  if (!t) return { ok: true, telefono: null };
  let d = t.replace(/\D/g, "");
  if (d.length === 13 && d.startsWith("521")) d = d.slice(3);
  else if (d.length === 12 && d.startsWith("52")) d = d.slice(2);
  return d.length === 10 ? { ok: true, telefono: d } : { ok: false };
}

export function validarBroker(p: { email: string; nombre: string; telefono?: string | null }): ResultadoValidacion {
  const email = p.email.trim().toLowerCase();
  const nombre = p.nombre.trim().replace(/\s+/g, " ");
  if (!nombre) return { ok: false, error: "Falta el nombre" };
  if (!email) return { ok: false, error: "Falta el correo" };
  if (!EMAIL.test(email)) return { ok: false, error: "El correo no es válido" };
  if (nombre.length > 150) return { ok: false, error: "El nombre es demasiado largo" };
  const tel = normalizarTelefono(p.telefono);
  if (!tel.ok) return { ok: false, error: "El teléfono debe tener 10 dígitos" };
  return { ok: true, email, nombre, telefono: tel.telefono };
}

/** El siguiente ID libre: B001, B002… (respeta los que ya existen, aunque haya huecos). */
export function siguienteId(existentes: Iterable<string>): string {
  let max = 0;
  for (const id of existentes) {
    const m = /^B(\d+)$/.exec(id);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `B${String(max + 1).padStart(3, "0")}`;
}

/** Lee CSV o texto pegado desde Excel (tabuladores). Respeta comillas. */
export function leerTabla(texto: string): string[][] {
  const limpio = texto.replace(/^﻿/, "");
  const primera = limpio.split(/\r?\n/, 1)[0] ?? "";
  const sep = primera.includes("\t") ? "\t" : (primera.split(";").length > primera.split(",").length ? ";" : ",");
  const filas: string[][] = [];
  let fila: string[] = [];
  let campo = "";
  let comillas = false;
  for (let i = 0; i < limpio.length; i++) {
    const ch = limpio[i];
    if (comillas) {
      if (ch === '"' && limpio[i + 1] === '"') {
        campo += '"';
        i++;
      } else if (ch === '"') comillas = false;
      else campo += ch;
    } else if (ch === '"' && campo === "") comillas = true;
    else if (ch === sep) {
      fila.push(campo);
      campo = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && limpio[i + 1] === "\n") i++;
      fila.push(campo);
      filas.push(fila);
      fila = [];
      campo = "";
    } else campo += ch;
  }
  if (campo !== "" || fila.length) {
    fila.push(campo);
    filas.push(fila);
  }
  return filas.filter((f) => f.some((c) => c.trim() !== ""));
}

const sinAcentos = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
const SINONIMOS: Record<"email" | "nombre" | "telefono" | "id", string[]> = {
  email: ["email", "correo", "e-mail", "correo electronico", "mail"],
  nombre: ["nombre", "nombre completo", "name", "broker", "aliado"],
  telefono: ["telefono", "celular", "whatsapp", "tel", "movil", "numero"],
  id: ["id", "id broker", "broker id", "id_broker", "clave", "codigo", "codigo broker", "id lendia", "clave lendia", "codigo lendia"],
};

/** Qué columna es cada dato, por su encabezado. */
export function mapearColumnas(encabezados: string[]): { email: number; nombre: number; telefono: number; id: number } | { error: string } {
  const h = encabezados.map(sinAcentos);
  const buscar = (campo: keyof typeof SINONIMOS) => h.findIndex((x) => SINONIMOS[campo].includes(x));
  const email = buscar("email");
  const nombre = buscar("nombre");
  if (email < 0 || nombre < 0) {
    return { error: `La primera fila debe traer los encabezados. Se necesitan al menos "Email" y "Nombre"; llegó: ${encabezados.join(", ") || "(vacío)"}` };
  }
  return { email, nombre, telefono: buscar("telefono"), id: buscar("id") };
}

/**
 * Forma de un ID de broker: el código de Lendia (FAPBR044) o el B### que
 * genera el backoffice (y que traía el Sheet). Igual que el CHECK de
 * brokers-schema.sql.
 */
export const ID_BROKER = /^[A-Z0-9][A-Z0-9-]{1,29}$/;

/**
 * " fapbr044 " → "FAPBR044"; "b7" → "B007". null si viene vacío; "error" si
 * no tiene forma de ID.
 */
export function normalizarId(texto: string | null | undefined): string | null | "error" {
  const t = String(texto ?? "").trim().toUpperCase();
  if (!t) return null;
  const b = /^B(\d+)$/.exec(t);
  if (b) return `B${b[1].padStart(3, "0")}`;
  return ID_BROKER.test(t) ? t : "error";
}

export interface FilaImportacion {
  /** Número de fila en el archivo (la 1 son los encabezados). */
  fila: number;
  email: string;
  nombre: string;
  telefono: string | null;
  /** El ID que trae el archivo (si trae). Si no, se genera al guardar. */
  id: string | null;
  estado: "nuevo" | "existe" | "error";
  /** Para "existe": el ID que ya tiene. Para "error": el motivo. */
  detalle: string | null;
}

/**
 * Valida el archivo completo contra los brokers que ya existen (correo → ID).
 * Los que no traen ID se numeran al guardar, dentro de la transacción.
 */
export function revisarImportacion(texto: string, existentes: Map<string, string>): { filas: FilaImportacion[] } | { error: string } {
  const tabla = leerTabla(texto);
  if (tabla.length < 2) return { error: "El archivo no trae filas de brokers (además de los encabezados)" };
  const cols = mapearColumnas(tabla[0]);
  if ("error" in cols) return cols;
  if (tabla.length - 1 > 2000) return { error: "Máximo 2,000 brokers por carga" };

  const correoDeId = new Map([...existentes].map(([email, id]) => [id, email]));
  const vistos = new Map<string, number>();
  const idsVistos = new Map<string, number>();
  const filas: FilaImportacion[] = tabla.slice(1).map((r, i) => {
    const n = i + 2;
    const celda = (c: number) => (c >= 0 ? (r[c] ?? "") : "");
    const crudo = { email: celda(cols.email), nombre: celda(cols.nombre), telefono: celda(cols.telefono) };
    const base = { fila: n, email: crudo.email.trim(), nombre: crudo.nombre.trim(), telefono: crudo.telefono.trim() || null, id: celda(cols.id).trim() || null };
    const error = (detalle: string): FilaImportacion => ({ ...base, estado: "error", detalle });

    const v = validarBroker(crudo);
    if (!v.ok) return error(v.error);
    const id = normalizarId(celda(cols.id));
    if (id === "error") return error("El ID solo puede llevar letras, números y guiones (por ejemplo FAPBR044)");
    const fila = { fila: n, email: v.email, nombre: v.nombre, telefono: v.telefono, id };

    const actual = existentes.get(v.email);
    if (actual) {
      if (id && id !== actual) return { ...fila, estado: "error", detalle: `Ese correo ya está dado de alta como ${actual}` };
      return { ...fila, id: actual, estado: "existe", detalle: actual };
    }
    if (id && correoDeId.has(id)) return { ...fila, estado: "error", detalle: `El ID ${id} ya es de ${correoDeId.get(id)}` };
    const previa = vistos.get(v.email);
    if (previa) return { ...fila, estado: "error", detalle: `Correo repetido en el archivo (fila ${previa})` };
    const idPrevio = id ? idsVistos.get(id) : undefined;
    if (idPrevio) return { ...fila, estado: "error", detalle: `ID repetido en el archivo (fila ${idPrevio})` };
    vistos.set(v.email, n);
    if (id) idsVistos.set(id, n);
    return { ...fila, estado: "nuevo", detalle: null };
  });
  return { filas };
}

/**
 * IDs para los nuevos: respeta el que trae el archivo y numera los demás
 * después del mayor (existentes + los del archivo), en el orden del archivo.
 */
export function asignarIds<T extends { id: string | null }>(nuevos: T[], idsExistentes: Iterable<string>): (T & { id: string })[] {
  const usados = [...idsExistentes, ...nuevos.flatMap((b) => (b.id ? [b.id] : []))];
  return nuevos.map((b) => {
    if (b.id) return { ...b, id: b.id };
    const id = siguienteId(usados);
    usados.push(id);
    return { ...b, id };
  });
}
