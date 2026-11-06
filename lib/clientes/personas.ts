// Personas de contacto y actividad comercial de una empresa (crm_personas,
// crm_actividades). Validación y textos: funciones puras, sin base de datos,
// para poder probarlas con `node --test`.

export const ROLES_DECISION = {
  decide: "Decide el crédito",
  influye: "Influye o evalúa",
  opera: "Opera (paga, entrega documentos)",
} as const;
export type RolDecision = keyof typeof ROLES_DECISION;

export const CANALES = { whatsapp: "WhatsApp", llamada: "Llamada", correo: "Correo" } as const;
export type Canal = keyof typeof CANALES;

export const TIPOS_ACTIVIDAD = {
  llamada: "Llamada",
  reunion: "Reunión",
  correo: "Correo",
  whatsapp: "WhatsApp",
  visita: "Visita",
  nota: "Nota",
} as const;
export type TipoActividad = keyof typeof TIPOS_ACTIVIDAD;

export const RESULTADOS_ACTIVIDAD = {
  contesto: "Contestó",
  no_contesto: "No contestó",
  interesado: "Interesado",
  no_interesado: "No interesado",
  seguimiento: "Quedó en seguimiento",
  otro: "Otro",
} as const;
export type ResultadoActividad = keyof typeof RESULTADOS_ACTIVIDAD;

export interface DatosPersona {
  nombre: string;
  puesto: string | null;
  rolDecision: RolDecision | null;
  esRepresentanteLegal: boolean;
  canalPreferido: Canal | null;
  horarioPreferido: string | null;
  esPrincipal: boolean;
  vigente: boolean;
  notas: string | null;
}

const LIMITES: Partial<Record<keyof DatosPersona, number>> = { nombre: 150, puesto: 120, horarioPreferido: 120, notas: 2000 };
const limpio = (v: unknown) => (typeof v === "string" ? v.trim() : "");

/** Valida y normaliza lo que llega del formulario. Un contacto que ya no está vigente no puede ser el principal. */
export function validarPersona(entrada: Record<string, unknown>): { ok: true; datos: DatosPersona } | { ok: false; error: string } {
  const nombre = limpio(entrada.nombre);
  if (!nombre) return { ok: false, error: "Escribe el nombre de la persona." };
  const rol = limpio(entrada.rolDecision);
  if (rol && !(rol in ROLES_DECISION)) return { ok: false, error: "El papel en la decisión no es válido." };
  const canal = limpio(entrada.canalPreferido);
  if (canal && !(canal in CANALES)) return { ok: false, error: "El canal preferido no es válido." };
  const si = (v: unknown) => v === true || v === "on" || v === "true" || v === "1";
  const vigente = entrada.vigente === undefined ? true : si(entrada.vigente);
  const datos: DatosPersona = {
    nombre,
    puesto: limpio(entrada.puesto) || null,
    rolDecision: (rol || null) as RolDecision | null,
    esRepresentanteLegal: si(entrada.esRepresentanteLegal),
    canalPreferido: (canal || null) as Canal | null,
    horarioPreferido: limpio(entrada.horarioPreferido) || null,
    esPrincipal: vigente && si(entrada.esPrincipal),
    vigente,
    notas: limpio(entrada.notas) || null,
  };
  for (const [campo, max] of Object.entries(LIMITES) as [keyof DatosPersona, number][]) {
    const v = datos[campo];
    if (typeof v === "string" && v.length > max) return { ok: false, error: `El campo ${campo} es demasiado largo (máximo ${max} caracteres).` };
  }
  return { ok: true, datos };
}

export interface DatosActividad {
  tipo: TipoActividad;
  resultado: ResultadoActividad | null;
  personaId: string | null;
  descripcion: string | null;
  /** ISO; nunca en el futuro. */
  ocurridoAt: string;
}

/**
 * Valida una actividad. `ocurrido` viene de un <input type="datetime-local">
 * (hora de Ciudad de México, sin zona) o vacío para «ahora». Una nota no lleva
 * resultado; las demás pueden llevarlo.
 */
export function validarActividad(entrada: Record<string, unknown>, ahora: Date = new Date()): { ok: true; datos: DatosActividad } | { ok: false; error: string } {
  const tipo = limpio(entrada.tipo);
  if (!(tipo in TIPOS_ACTIVIDAD)) return { ok: false, error: "Elige qué tipo de actividad fue." };
  const resultado = limpio(entrada.resultado);
  if (resultado && !(resultado in RESULTADOS_ACTIVIDAD)) return { ok: false, error: "El resultado no es válido." };
  const descripcion = limpio(entrada.descripcion) || null;
  if (tipo === "nota" && !descripcion) return { ok: false, error: "Escribe la nota." };
  if (descripcion && descripcion.length > 4000) return { ok: false, error: "La descripción es demasiado larga (máximo 4,000 caracteres)." };
  const personaId = limpio(entrada.personaId) || null;
  if (personaId && !/^[0-9a-f-]{36}$/i.test(personaId)) return { ok: false, error: "La persona no es válida." };

  let ocurridoAt = ahora.toISOString();
  const ocurrido = limpio(entrada.ocurrido);
  if (ocurrido) {
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(ocurrido)) return { ok: false, error: "La fecha y hora no son válidas." };
    // Ciudad de México no tiene horario de verano desde 2022: UTC-6 todo el año.
    const fecha = new Date(`${ocurrido}:00-06:00`);
    if (Number.isNaN(fecha.getTime())) return { ok: false, error: "La fecha y hora no son válidas." };
    if (fecha.getTime() > ahora.getTime() + 5 * 60_000) return { ok: false, error: "La actividad no puede estar en el futuro. Para algo pendiente, crea una tarea." };
    ocurridoAt = fecha.toISOString();
  }
  return { ok: true, datos: { tipo: tipo as TipoActividad, resultado: tipo === "nota" ? null : ((resultado || null) as ResultadoActividad | null), personaId, descripcion, ocurridoAt } };
}

// ---------------------------------------------------------------- historial

export type OrigenHistorial = "comercial" | "cobranza" | "siac";

export interface EntradaHistorial {
  id: string;
  origen: OrigenHistorial;
  /** Etiqueta corta ("Llamada", "Pago", "Atraso"…). */
  tipo: string;
  descripcion: string | null;
  /** Quién la registró; null si fue el sistema. */
  actor: string | null;
  persona: string | null;
  resultado: string | null;
  ocurridoAt: string;
}

/** Tipos de col_activities que son hechos de SIAC o del sistema, no gestiones de una persona. */
const TIPOS_SIAC = new Set(["pago_detectado", "pago_registrado", "entrada_mora", "regularizacion", "nueva_mensualidad_vencida", "salida_listado", "alerta"]);

export const FILTROS_HISTORIAL: { value: "todo" | OrigenHistorial; label: string }[] = [
  { value: "todo", label: "Todo" },
  { value: "comercial", label: "Comercial" },
  { value: "cobranza", label: "Cobranza" },
  { value: "siac", label: "SIAC" },
];

/**
 * Une la actividad comercial (crm_actividades) con el expediente de cobranza
 * (col_activities) en un solo historial, del más reciente al más viejo.
 */
export function unirHistorial(
  comercial: { id: string; tipo: string; resultado: string | null; descripcion: string | null; actor: string; persona: string | null; ocurridoAt: string }[],
  cobranza: { id: string; tipo: string; etiqueta: string; descripcion: string | null; actor: string; ocurridoAt: string }[],
  filtro: "todo" | OrigenHistorial = "todo",
): EntradaHistorial[] {
  const todas: EntradaHistorial[] = [
    ...comercial.map((a) => ({
      id: `c${a.id}`,
      origen: "comercial" as const,
      tipo: TIPOS_ACTIVIDAD[a.tipo as TipoActividad] ?? a.tipo,
      descripcion: a.descripcion,
      actor: a.actor === "sistema" ? null : a.actor,
      persona: a.persona,
      resultado: a.resultado ? (RESULTADOS_ACTIVIDAD[a.resultado as ResultadoActividad] ?? a.resultado) : null,
      ocurridoAt: a.ocurridoAt,
    })),
    ...cobranza.map((a) => ({
      id: `k${a.id}`,
      origen: (TIPOS_SIAC.has(a.tipo) || a.actor === "sistema" ? "siac" : "cobranza") as OrigenHistorial,
      tipo: a.etiqueta,
      descripcion: a.descripcion,
      actor: a.actor === "sistema" ? null : a.actor,
      persona: null,
      resultado: null,
      ocurridoAt: a.ocurridoAt,
    })),
  ];
  return todas
    .filter((e) => filtro === "todo" || e.origen === filtro)
    .sort((a, b) => b.ocurridoAt.localeCompare(a.ocurridoAt) || b.id.localeCompare(a.id));
}
