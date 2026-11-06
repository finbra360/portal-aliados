// Tareas del equipo sobre una empresa (crm_tareas) y el resumen de «Mi cartera»
// del Inicio. Funciones puras, sin base de datos, para poder probarlas con
// `node --test`.

export const TIPOS_TAREA = {
  llamada: "Llamada",
  seguimiento: "Seguimiento",
  revision: "Revisión",
  incidencia: "Incidencia",
  dato_faltante: "Dato faltante",
  otro: "Otro",
} as const;
export type TipoTarea = keyof typeof TIPOS_TAREA;

/** Días sin contacto de una persona del equipo antes de avisar. */
export const DIAS_SIN_CONTACTO = 60;

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

export interface ClienteCartera {
  empresaId: string;
  nombre: string;
  enMora: boolean;
  maxAtraso: number;
  creditosVigentes: number;
  tienePrincipal: boolean;
  /** Último contacto de una persona del equipo (actividad comercial o gestión de cobranza), ISO. */
  ultimoContacto: string | null;
}

// Sin aviso de RFC: SIAC no lo manda (ni el listado ni ninguna otra respuesta), así que
// saldría en todos los clientes. Agregarlo cuando SIAC lo incluya en el listado personalizado.
export type TipoAviso = "mora" | "sin_contacto" | "sin_principal";

export interface Aviso {
  empresaId: string;
  nombre: string;
  tipo: TipoAviso;
  texto: string;
}

const ORDEN_AVISO: Record<TipoAviso, number> = { mora: 0, sin_contacto: 1, sin_principal: 2 };

/**
 * Avisos de los clientes de un ejecutivo: en mora, sin contacto de una persona
 * del equipo en `dias` días (solo si tienen crédito vigente) o sin contacto
 * principal. Primero los más urgentes.
 */
export function avisosDeCartera(clientes: ClienteCartera[], hoy: string, dias = DIAS_SIN_CONTACTO): Aviso[] {
  const limite = Date.parse(`${hoy}T00:00:00Z`) - dias * 86_400_000;
  const avisos: Aviso[] = [];
  for (const c of clientes) {
    if (c.enMora) avisos.push({ empresaId: c.empresaId, nombre: c.nombre, tipo: "mora", texto: `En mora: ${c.maxAtraso} ${c.maxAtraso === 1 ? "día" : "días"} de atraso` });
    if (c.creditosVigentes > 0 && (!c.ultimoContacto || Date.parse(c.ultimoContacto) < limite)) {
      const desde = c.ultimoContacto ? Math.floor((Date.parse(`${hoy}T00:00:00Z`) - Date.parse(c.ultimoContacto)) / 86_400_000) : null;
      avisos.push({ empresaId: c.empresaId, nombre: c.nombre, tipo: "sin_contacto", texto: desde === null ? "Sin contacto registrado" : `Sin contacto hace ${desde} días` });
    }
    if (!c.tienePrincipal) avisos.push({ empresaId: c.empresaId, nombre: c.nombre, tipo: "sin_principal", texto: "Sin contacto principal" });
  }
  return avisos.sort((a, b) => ORDEN_AVISO[a.tipo] - ORDEN_AVISO[b.tipo] || a.nombre.localeCompare(b.nombre, "es", { sensitivity: "base" }));
}
