import { CLASIFICACIONES, ESTADOS_CONTACTO, SECTORES, type Clasificacion, type EstadoContacto } from "./catalogo.ts";

export const PAGINA_CH = 25;

export interface FiltrosProspectos {
  clasificacion?: Clasificacion;
  contacto?: EstadoContacto;
  sector?: string;
  montoMin?: number;
  montoMax?: number;
  pagoMin?: number;
  q?: string;
  orden: "recientes" | "monto" | "score" | "capacidad";
  /** Por defecto se ocultan los prospectos de demostración. */
  incluirDemo: boolean;
  pagina: number;
}

type Params = Record<string, string | string[] | undefined> | URLSearchParams;

const get = (p: Params, k: string): string | undefined => {
  if (p instanceof URLSearchParams) return p.get(k) ?? undefined;
  const v = p[k];
  return Array.isArray(v) ? v[0] : v;
};

const num = (v: string | undefined) => {
  if (!v || !v.trim()) return undefined;
  const n = Number(v.replace(/[^\d]/g, ""));
  return Number.isFinite(n) && v.replace(/[^\d]/g, "") !== "" ? n : undefined;
};

/** Convierte los parámetros de la URL en filtros validados (lista blanca). */
export function parseFiltros(p: Params): FiltrosProspectos {
  const clasif = get(p, "clasificacion");
  const contacto = get(p, "contacto");
  const sector = get(p, "sector");
  const orden = get(p, "orden");
  return {
    clasificacion: clasif && (CLASIFICACIONES as readonly string[]).includes(clasif) ? (clasif as Clasificacion) : undefined,
    contacto: contacto && (ESTADOS_CONTACTO as readonly string[]).includes(contacto) ? (contacto as EstadoContacto) : undefined,
    sector: sector && sector in SECTORES ? sector : undefined,
    montoMin: num(get(p, "montoMin")),
    montoMax: num(get(p, "montoMax")),
    pagoMin: num(get(p, "pagoMin")),
    q: get(p, "q")?.trim().slice(0, 80) || undefined,
    orden: orden === "monto" || orden === "score" || orden === "capacidad" ? orden : "recientes",
    incluirDemo: get(p, "demo") === "1",
    pagina: Math.max(1, Math.min(1000, num(get(p, "pagina")) ?? 1)),
  };
}

/** Query string con los filtros actuales y algunos cambios. */
export function filtrosQuery(p: Params, cambios: Record<string, string | undefined> = {}) {
  const claves = ["clasificacion", "contacto", "sector", "montoMin", "montoMax", "pagoMin", "q", "orden", "demo", "pagina"];
  const q = new URLSearchParams();
  for (const k of claves) {
    const v = k in cambios ? cambios[k] : get(p, k);
    if (v) q.set(k, v);
  }
  const s = q.toString();
  return s ? `?${s}` : "";
}
