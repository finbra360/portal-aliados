// Anuncios del backoffice para los brokers: a quién llegan, si siguen vigentes
// y la validación del formulario. Lógica pura (sin base de datos) para probarla
// con `node --test`; el guardado está en lib/db/announcements.ts.

import { normalizarId } from "./brokers/importar.ts";

export type Audiencia = { tipo: "todos" } | { tipo: "brokers"; ids: string[] };

export const LIMITE_TITULO = 120;
export const LIMITE_MENSAJE = 600;
export const LIMITE_BROKERS_POR_ANUNCIO = 200;

/** Lo que se guardó en la columna jsonb. Lo que no se reconoce cuenta como "todos". */
export function leerAudiencia(raw: unknown): Audiencia {
  if (raw && typeof raw === "object") {
    const a = raw as { tipo?: unknown; ids?: unknown };
    if (a.tipo === "brokers" && Array.isArray(a.ids)) {
      return { tipo: "brokers", ids: a.ids.filter((x): x is string => typeof x === "string") };
    }
  }
  return { tipo: "todos" };
}

export function audienciaIncluye(audiencia: Audiencia, brokerId: string): boolean {
  return audiencia.tipo === "todos" || audiencia.ids.includes(brokerId);
}

export interface VigenciaAnuncio {
  fechaPublicacion: string;
  fechaExpiracion: string | null;
}

/** Publicado ya y todavía sin expirar. `ahora` en ISO (se compara como fecha, no como texto). */
export function anuncioVigente(a: VigenciaAnuncio, ahora: string): boolean {
  const t = Date.parse(ahora);
  if (Date.parse(a.fechaPublicacion) > t) return false;
  return a.fechaExpiracion === null || Date.parse(a.fechaExpiracion) > t;
}

export type EstadoAnuncio = "programado" | "vigente" | "terminado";

export function estadoDeAnuncio(a: VigenciaAnuncio, ahora: string): EstadoAnuncio {
  const t = Date.parse(ahora);
  if (Date.parse(a.fechaPublicacion) > t) return "programado";
  return a.fechaExpiracion !== null && Date.parse(a.fechaExpiracion) <= t ? "terminado" : "vigente";
}

/** Solo enlaces seguros: https:// o una ruta del propio portal ("/ranking"). Nada de javascript: ni //otro-sitio. */
export function ctaUrlSegura(url: string): boolean {
  if (/^\/(?!\/)/.test(url)) return true;
  try {
    return new URL(url).protocol === "https:";
  } catch {
    return false;
  }
}

export interface AnuncioNuevo {
  titulo: string;
  mensaje: string;
  ctaTexto: string | null;
  ctaUrl: string | null;
  audiencia: Audiencia;
  /** YYYY-MM-DD; el anuncio sigue visible todo ese día. */
  expiraEl: string | null;
}

export function validarAnuncio(
  p: { titulo: string; mensaje: string; ctaTexto?: string; ctaUrl?: string; audiencia?: string; brokers?: string; expiraEl?: string },
  hoy: string,
): ({ ok: true } & AnuncioNuevo) | { ok: false; error: string } {
  const titulo = p.titulo.trim().replace(/\s+/g, " ");
  const mensaje = p.mensaje.trim();
  if (!titulo) return { ok: false, error: "Falta el título" };
  if (titulo.length > LIMITE_TITULO) return { ok: false, error: `El título no puede pasar de ${LIMITE_TITULO} caracteres` };
  if (!mensaje) return { ok: false, error: "Falta el mensaje" };
  if (mensaje.length > LIMITE_MENSAJE) return { ok: false, error: `El mensaje no puede pasar de ${LIMITE_MENSAJE} caracteres` };

  const ctaTexto = (p.ctaTexto ?? "").trim() || null;
  const ctaUrl = (p.ctaUrl ?? "").trim() || null;
  if ((ctaTexto === null) !== (ctaUrl === null)) {
    return { ok: false, error: "El botón necesita texto y enlace, o ninguno de los dos" };
  }
  if (ctaUrl !== null && !ctaUrlSegura(ctaUrl)) {
    return { ok: false, error: "El enlace debe empezar con https:// o con / (una página del portal)" };
  }

  let audiencia: Audiencia = { tipo: "todos" };
  if (p.audiencia === "brokers") {
    const ids: string[] = [];
    for (const parte of (p.brokers ?? "").split(/[\s,;]+/)) {
      if (!parte) continue;
      const id = normalizarId(parte);
      if (id === "error" || id === null) return { ok: false, error: `"${parte}" no es un ID de broker válido` };
      if (!ids.includes(id)) ids.push(id);
    }
    if (ids.length === 0) return { ok: false, error: "Escribe al menos un ID de broker o elige \"Todos los brokers\"" };
    if (ids.length > LIMITE_BROKERS_POR_ANUNCIO) return { ok: false, error: `Máximo ${LIMITE_BROKERS_POR_ANUNCIO} brokers por anuncio` };
    audiencia = { tipo: "brokers", ids };
  }

  const expiraEl = (p.expiraEl ?? "").trim() || null;
  if (expiraEl !== null) {
    const r = /^(\d{4})-(\d{2})-(\d{2})$/.exec(expiraEl);
    const f = r ? new Date(Date.UTC(Number(r[1]), Number(r[2]) - 1, Number(r[3]))) : null;
    if (!r || !f || f.getUTCMonth() !== Number(r[2]) - 1 || f.getUTCDate() !== Number(r[3])) {
      return { ok: false, error: "La fecha de expiración no es válida" };
    }
    if (expiraEl < hoy) return { ok: false, error: "La fecha de expiración ya pasó" };
  }

  return { ok: true, titulo, mensaje, ctaTexto, ctaUrl, audiencia, expiraEl };
}
