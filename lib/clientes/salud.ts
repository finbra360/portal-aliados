// Salud del cliente: ¿la relación está bien o necesita que alguien la atienda?
// Mira cómo va HOY (pago actual y reciente, contacto con el equipo y datos
// clave). No es el semáforo de pago, que resume toda su historia en SIAC.
//
// Cada empresa con crédito vigente parte de 100 puntos y pierde puntos por cada
// señal; cada descuento lleva su razón para que nunca sea un número sin
// explicación. Funciones puras, sin base de datos, para probarlas con `node --test`.

export type NivelSalud = "sana" | "atencion" | "riesgo";

export const NIVELES_SALUD: Record<NivelSalud, string> = {
  sana: "Sana",
  atencion: "Atención",
  riesgo: "En riesgo",
};

/** De peor a mejor, para ordenar y contar. */
export const ORDEN_NIVELES: NivelSalud[] = ["riesgo", "atencion", "sana"];

export interface AjustesSalud {
  /** Desde estos puntos es «Sana». */
  corteSana: number;
  /** Desde estos puntos (y debajo de corteSana) es «Atención»; abajo, «En riesgo». */
  corteAtencion: number;
  /** Atraso de hoy: hasta `atrasoLeveDias` días resta `atrasoLeve`; hasta `atrasoMedioDias`, `atrasoMedio`; más, `atrasoGrave`. */
  atrasoLeveDias: number;
  atrasoLeve: number;
  atrasoMedioDias: number;
  atrasoMedio: number;
  atrasoGrave: number;
  /** Algún crédito vigente en jurídico, extrajudicial o reestructura. */
  cobranzaEspecial: number;
  /** Veces que entró en atraso dentro de la ventana (sin contar el atraso de hoy). */
  ventanaAtrasosDias: number;
  unAtraso: number;
  variosAtrasos: number;
  /** Promesas de pago incumplidas dentro de la ventana (resta una vez, sean cuantas sean). */
  ventanaPromesasDias: number;
  promesaIncumplida: number;
  /** Días desde el último contacto de una persona del equipo. */
  contacto31a60: number;
  contacto61a90: number;
  contactoMas90: number;
  /** Primeros días como cliente en que la falta de contacto no resta. */
  graciaContactoDias: number;
  /** Por cada dato clave que falta: contacto principal, cuenta de pago, WhatsApp válido. */
  datoFaltante: number;
}

export const AJUSTES_SALUD_DEFAULT: AjustesSalud = {
  corteSana: 80,
  corteAtencion: 60,
  atrasoLeveDias: 7,
  atrasoLeve: 25,
  atrasoMedioDias: 30,
  atrasoMedio: 45,
  atrasoGrave: 60,
  cobranzaEspecial: 60,
  ventanaAtrasosDias: 90,
  unAtraso: 10,
  variosAtrasos: 25,
  ventanaPromesasDias: 60,
  promesaIncumplida: 15,
  contacto31a60: 5,
  contacto61a90: 15,
  contactoMas90: 25,
  graciaContactoDias: 30,
  datoFaltante: 5,
};

/** Nombre de cada ajuste en crm_settings (clave `salud`), en snake_case como los demás ajustes. */
const CLAVES: Record<keyof AjustesSalud, string> = {
  corteSana: "corte_sana",
  corteAtencion: "corte_atencion",
  atrasoLeveDias: "atraso_leve_dias",
  atrasoLeve: "atraso_leve",
  atrasoMedioDias: "atraso_medio_dias",
  atrasoMedio: "atraso_medio",
  atrasoGrave: "atraso_grave",
  cobranzaEspecial: "cobranza_especial",
  ventanaAtrasosDias: "ventana_atrasos_dias",
  unAtraso: "un_atraso",
  variosAtrasos: "varios_atrasos",
  ventanaPromesasDias: "ventana_promesas_dias",
  promesaIncumplida: "promesa_incumplida",
  contacto31a60: "contacto_31_a_60",
  contacto61a90: "contacto_61_a_90",
  contactoMas90: "contacto_mas_90",
  graciaContactoDias: "gracia_contacto_dias",
  datoFaltante: "dato_faltante",
};

/**
 * Lee el ajuste `salud` de crm_settings. Lo que falte o no sea un entero entre
 * 0 y 365 queda con el valor por omisión; si los cortes quedan al revés, se
 * usan los de omisión.
 */
export function leerAjustesSalud(raw: unknown): AjustesSalud {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const a = { ...AJUSTES_SALUD_DEFAULT };
  for (const k of Object.keys(CLAVES) as (keyof AjustesSalud)[]) {
    const v = r[CLAVES[k]];
    const n = Number(v);
    if (v !== undefined && v !== null && v !== "" && Number.isInteger(n) && n >= 0 && n <= 365) a[k] = n;
  }
  if (a.corteAtencion > a.corteSana || a.corteSana > 100) {
    a.corteSana = AJUSTES_SALUD_DEFAULT.corteSana;
    a.corteAtencion = AJUSTES_SALUD_DEFAULT.corteAtencion;
  }
  return a;
}

/** Lo que se sabe de la relación con la empresa fuera de la foto de SIAC (ver lib/db/salud.ts). */
export interface RelacionSalud {
  tienePrincipal: boolean;
  /** Último contacto de una persona del equipo, ISO. */
  ultimoContacto: string | null;
  cuentaPago: boolean;
  whatsappValido: boolean;
  /** Veces que alguno de sus créditos pasó de 0 a más días de atraso dentro de la ventana (días distintos). */
  atrasosRecientes: number;
  /** Promesas de pago incumplidas dentro de la ventana. */
  promesasIncumplidas: number;
  /** Fecha de ministración de su primer crédito (YYYY-MM-DD). */
  clienteDesde: string | null;
}

export interface SenalesSalud extends RelacionSalud {
  creditosVigentes: number;
  /** Peor atraso de hoy entre sus créditos vigentes, en días. */
  atrasoDias: number;
  /** Su vencido pasa el umbral de mora: el atraso de hoy cuenta (debajo son residuos). */
  enMora: boolean;
  cobranzaEspecial: boolean;
}

export interface RazonSalud {
  texto: string;
  /** Puntos que resta (positivo). */
  puntos: number;
}

export interface Salud {
  puntos: number;
  nivel: NivelSalud;
  /** Lo que le restó puntos, de lo que más resta a lo que menos. */
  razones: RazonSalud[];
}

const MS_DIA = 86_400_000;
const FECHA_MX = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Mexico_City" });
const plural = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`;

export function nivelDe(puntos: number, a: AjustesSalud): NivelSalud {
  return puntos >= a.corteSana ? "sana" : puntos >= a.corteAtencion ? "atencion" : "riesgo";
}

/** Salud de una empresa; null si no tiene créditos vigentes (ex clientes y sin créditos no llevan salud). */
export function calcularSalud(s: SenalesSalud, a: AjustesSalud, hoy: string): Salud | null {
  if (s.creditosVigentes === 0) return null;
  const razones: RazonSalud[] = [];
  const restar = (puntos: number, texto: string) => {
    if (puntos > 0) razones.push({ texto, puntos });
  };

  if (s.cobranzaEspecial) restar(a.cobranzaEspecial, "En cobranza especial (jurídico, extrajudicial o reestructura)");

  if (s.enMora && s.atrasoDias > 0) {
    const texto = `${plural(s.atrasoDias, "día", "días")} de atraso hoy`;
    restar(s.atrasoDias <= a.atrasoLeveDias ? a.atrasoLeve : s.atrasoDias <= a.atrasoMedioDias ? a.atrasoMedio : a.atrasoGrave, texto);
  }

  // El atraso de hoy ya restó arriba: aquí cuentan solo las otras veces.
  const otros = Math.max(0, s.atrasosRecientes - (s.atrasoDias > 0 ? 1 : 0));
  if (otros > 0) {
    const veces = plural(otros, "vez", "veces");
    const texto = s.atrasoDias > 0 ? `Antes de este atraso, se atrasó ${veces} en los últimos ${a.ventanaAtrasosDias} días` : `Se atrasó ${veces} en los últimos ${a.ventanaAtrasosDias} días`;
    restar(otros === 1 ? a.unAtraso : a.variosAtrasos, texto);
  }

  if (s.promesasIncumplidas > 0) {
    restar(a.promesaIncumplida, `${plural(s.promesasIncumplidas, "promesa de pago incumplida", "promesas de pago incumplidas")} en los últimos ${a.ventanaPromesasDias} días`);
  }

  const hoyMs = Date.parse(`${hoy}T00:00:00Z`);
  const enGracia = s.clienteDesde !== null && Math.floor((hoyMs - Date.parse(`${s.clienteDesde}T00:00:00Z`)) / MS_DIA) < a.graciaContactoDias;
  if (!enGracia) {
    if (!s.ultimoContacto) {
      restar(a.contactoMas90, "Sin contacto registrado del equipo");
    } else {
      // Por día de calendario en México: una llamada de anoche fue «hace 1 día».
      const d = Math.round((hoyMs - Date.parse(`${FECHA_MX.format(new Date(s.ultimoContacto))}T00:00:00Z`)) / MS_DIA);
      const texto = `Sin contacto del equipo hace ${plural(d, "día", "días")}`;
      if (d > 90) restar(a.contactoMas90, texto);
      else if (d > 60) restar(a.contacto61a90, texto);
      else if (d > 30) restar(a.contacto31a60, texto);
    }
  }

  if (!s.tienePrincipal) restar(a.datoFaltante, "Sin contacto principal");
  if (!s.cuentaPago) restar(a.datoFaltante, "Sin cuenta de pago asignada");
  if (!s.whatsappValido) restar(a.datoFaltante, "Sin WhatsApp válido para cobranza");

  razones.sort((x, y) => y.puntos - x.puntos);
  const puntos = Math.max(0, 100 - razones.reduce((t, r) => t + r.puntos, 0));
  return { puntos, nivel: nivelDe(puntos, a), razones };
}

/** Sin datos de relación (no debería pasar): se toma como si no hubiera nada registrado. */
const RELACION_VACIA: RelacionSalud = {
  tienePrincipal: false,
  ultimoContacto: null,
  cuentaPago: false,
  whatsappValido: false,
  atrasosRecientes: 0,
  promesasIncumplidas: 0,
  clienteDesde: null,
};

/** Señales a partir de la fila de la lista de clientes y de su relación. */
export function senalesDe(
  e: { creditosVigentes: number; maxAtraso: number; enMora: boolean; etapa: string },
  rel: RelacionSalud | undefined,
): SenalesSalud {
  return {
    ...(rel ?? RELACION_VACIA),
    creditosVigentes: e.creditosVigentes,
    atrasoDias: e.maxAtraso,
    enMora: e.enMora,
    cobranzaEspecial: e.etapa === "cobranza_especial",
  };
}

/** Peor salud primero; los que no llevan salud, al final. */
export function compararSalud(a: Salud | null, b: Salud | null): number {
  if (!a || !b) return (a ? 0 : 1) - (b ? 0 : 1);
  return a.puntos - b.puntos;
}

/**
 * Puntos de hace `dias` días según la historia guardada: el día guardado más
 * reciente que no sea posterior a esa fecha (por si el cron no corrió ese día),
 * siempre que no tenga más de 3 días de diferencia. null si no hay.
 */
export function puntosHace(historia: { fecha: string; puntos: number }[], hoy: string, dias: number): number | null {
  const objetivo = Date.parse(`${hoy}T00:00:00Z`) - dias * MS_DIA;
  let mejor: { fecha: string; puntos: number } | null = null;
  for (const h of historia) {
    const t = Date.parse(`${h.fecha}T00:00:00Z`);
    if (t <= objetivo && objetivo - t <= 3 * MS_DIA && (!mejor || h.fecha > mejor.fecha)) mejor = h;
  }
  return mejor ? mejor.puntos : null;
}
