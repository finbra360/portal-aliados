/** Etiquetas de Credit Health (mismas que en el repositorio finbra360/credit-health). */

export const CLASIFICACIONES = ["alta_prioridad", "revision_analista", "informacion_incompleta", "no_elegible"] as const;
export type Clasificacion = (typeof CLASIFICACIONES)[number];

export const CLASIFICACION_LABELS: Record<Clasificacion, string> = {
  alta_prioridad: "Alta prioridad comercial",
  revision_analista: "Revisión por analista",
  informacion_incompleta: "Información incompleta",
  no_elegible: "No elegible",
};

export const ESTADOS_CONTACTO = ["nuevo", "contactado", "en_evaluacion", "documentacion", "convertido", "no_responde", "descartado"] as const;
export type EstadoContacto = (typeof ESTADOS_CONTACTO)[number];

export const ESTADO_CONTACTO_LABELS: Record<EstadoContacto, string> = {
  nuevo: "Nuevo",
  contactado: "Contactado",
  en_evaluacion: "En evaluación",
  documentacion: "Integrando documentación",
  convertido: "Convertido",
  no_responde: "No responde",
  descartado: "Descartado",
};

export const INTENCION_LABELS: Record<string, string> = {
  inicio: "Dejó sus datos, sin terminar",
  diagnostico: "Completó el diagnóstico",
  asesoria: "Solicitó asesoría",
  llamada: "Pidió una llamada",
  solicitud: "Apartó su evaluación",
  guardar: "Guardó su diagnóstico",
  reporte: "Descargó el reporte PDF",
};

export const ELEGIBILIDAD_LABELS: Record<string, string> = {
  // Igual que en Credit Health: se evita «elegible» porque el diagnóstico no es preaprobación.
  potencialmente_elegible: "Perfil preliminar favorable",
  requiere_revision: "Requiere revisión",
  no_elegible: "No elegible bajo criterios actuales",
  informacion_insuficiente: "Información insuficiente",
  sin_diagnostico: "Sin diagnóstico todavía",
};

/** «evento:expo-pyme-2026» → «Evento: expo-pyme-2026»; «web:finbra-inicio» → «finbra.com: finbra-inicio». */
export function origenLabel(source: string | null): string {
  if (!source || source === "diagnostico") return "Directo a health.finbra.com";
  if (source === "demo") return "Demostración";
  if (source.startsWith("evento:")) return `Evento: ${source.slice("evento:".length)}`;
  if (source.startsWith("web:")) return `finbra.com: ${source.slice("web:".length)}`;
  return source;
}

/** Sectores SCIAN (INEGI), nombre corto. */
export const SECTORES: Record<string, string> = {
  "11": "Agropecuario",
  "21": "Minería",
  "22": "Energía y agua",
  "23": "Construcción",
  "31-33": "Manufactura",
  "43": "Comercio mayorista",
  "46": "Comercio minorista",
  "48-49": "Transporte y logística",
  "51": "Medios e información",
  "52": "Servicios financieros",
  "53": "Inmobiliario y alquiler",
  "54": "Servicios profesionales",
  "55": "Corporativos",
  "56": "Apoyo a negocios",
  "61": "Educación",
  "62": "Salud",
  "71": "Esparcimiento",
  "72": "Hoteles y restaurantes",
  "81": "Otros servicios",
  "93": "Gobierno",
};

export const GARANTIA_LABELS: Record<string, string> = {
  vehicular: "Vehicular",
  inmobiliaria: "Inmobiliaria",
  otra: "Otra",
  ninguna: "Sin garantía",
};

export const DESTINO_LABELS: Record<string, string> = {
  capital_trabajo: "Capital de trabajo",
  inventario: "Inventario o materia prima",
  maquinaria_equipo: "Maquinaria, equipo o vehículos",
  expansion: "Expansión",
  refinanciamiento: "Refinanciar deudas",
  liquidez_puntual: "Liquidez puntual",
  otro: "Otro",
};

export const FIGURA_LABELS: Record<string, string> = {
  persona_moral: "Persona moral",
  pfae: "Persona física con actividad empresarial",
  persona_fisica: "Persona física sin actividad empresarial",
  extranjera: "Empresa extranjera",
};

export const HISTORIAL_LABELS: Record<string, string> = {
  sin_atrasos: "Siempre ha pagado a tiempo",
  atrasos_menores: "Atrasos menores a 30 días",
  atrasos_mayores: "Atrasos de 30 días o más",
  sin_historial: "Nunca ha tenido créditos",
  no_se: "No lo sabe",
};
