// Tareas del equipo sobre una empresa (crm_tareas) y el resumen de «Mi cartera»
// del Inicio. Funciones puras, sin base de datos, para poder probarlas con
// `node --test`.

import { compararSalud, type Salud, type SenalSalud } from "./salud.ts";

export const TIPOS_TAREA = {
  llamada: "Llamada",
  seguimiento: "Seguimiento",
  revision: "Revisión",
  incidencia: "Incidencia",
  dato_faltante: "Dato faltante",
  otro: "Otro",
} as const;
export type TipoTarea = keyof typeof TIPOS_TAREA;

export interface DatosTarea {
  titulo: string;
  tipo: TipoTarea;
  venceEl: string;
  responsableEmail: string | null;
  descripcion: string | null;
}

const limpio = (v: unknown) => (typeof v === "string" ? v.trim() : "");

/** Valida lo que llega del formulario. La fecha no puede ser anterior a hoy (hora de Ciudad de México). */
export function validarTarea(entrada: Record<string, unknown>, hoy: string): { ok: true; datos: DatosTarea } | { ok: false; error: string } {
  const titulo = limpio(entrada.titulo);
  if (!titulo) return { ok: false, error: "Escribe qué hay que hacer." };
  if (titulo.length > 200) return { ok: false, error: "El título es demasiado largo (máximo 200 caracteres)." };
  const tipo = limpio(entrada.tipo) || "seguimiento";
  if (!(tipo in TIPOS_TAREA)) return { ok: false, error: "El tipo de tarea no es válido." };
  const venceEl = limpio(entrada.venceEl);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(venceEl) || Number.isNaN(Date.parse(`${venceEl}T00:00:00Z`))) return { ok: false, error: "Elige para cuándo es." };
  if (venceEl < hoy) return { ok: false, error: "La fecha no puede ser anterior a hoy." };
  const responsable = limpio(entrada.responsableEmail).toLowerCase();
  if (responsable && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(responsable)) return { ok: false, error: "El responsable no es válido." };
  const descripcion = limpio(entrada.descripcion) || null;
  if (descripcion && descripcion.length > 2000) return { ok: false, error: "La descripción es demasiado larga (máximo 2,000 caracteres)." };
  return { ok: true, datos: { titulo, tipo: tipo as TipoTarea, venceEl, responsableEmail: responsable || null, descripcion } };
}

export type Plazo = "vencida" | "hoy" | "semana" | "despues";

/** Cuándo toca una tarea abierta respecto de hoy: vencida, hoy, en los próximos 7 días o después. */
export function plazoDe(venceEl: string, hoy: string): Plazo {
  if (venceEl < hoy) return "vencida";
  if (venceEl === hoy) return "hoy";
  const dias = Math.round((Date.parse(`${venceEl}T00:00:00Z`) - Date.parse(`${hoy}T00:00:00Z`)) / 86_400_000);
  return dias <= 7 ? "semana" : "despues";
}

/** Pestaña de la ficha donde se atiende cada tipo de razón de la salud. */
const PESTANA: Record<SenalSalud, "" | "actividad" | "contactos"> = { pago: "", contacto: "actividad", datos: "contactos" };

export interface AvisoCartera {
  empresaId: string;
  nombre: string;
  salud: Salud;
  /** Pestaña de la ficha donde se atiende su razón principal ("" = Resumen). */
  pestana: "" | "actividad" | "contactos";
}

/**
 * Avisos de los clientes de un ejecutivo: los que su salud pone en Atención o
 * En riesgo, del peor al mejor. Así un cliente sale una sola vez, con todo lo
 * que le resta, y lo que la salud perdona (la gracia de los clientes nuevos)
 * tampoco se avisa.
 */
export function avisosDeCartera(clientes: { empresaId: string; nombre: string; salud: Salud | null }[]): AvisoCartera[] {
  return clientes
    .filter((c): c is { empresaId: string; nombre: string; salud: Salud } => !!c.salud && c.salud.nivel !== "sana")
    .sort((a, b) => compararSalud(a.salud, b.salud) || a.nombre.localeCompare(b.nombre, "es", { sensitivity: "base" }))
    .map((c) => ({ empresaId: c.empresaId, nombre: c.nombre, salud: c.salud, pestana: PESTANA[c.salud.razones[0]?.senal ?? "pago"] }));
}
