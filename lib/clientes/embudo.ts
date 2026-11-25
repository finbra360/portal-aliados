// Métricas del embudo de originación (fase O6): cuántos negocios entran,
// hasta dónde llegan, cuánto tardan en cada etapa, cuáles están atorados y
// cuánto se dispersa, en total y por origen, ejecutivo y broker. Salen del
// historial de etapas (crm_negocio_etapas). Funciones puras, sin base de
// datos, para probarlas con `node --test`.

import { ETAPAS_ABIERTAS, ETAPAS_NEGOCIO, diasEnEtapa, type EtapaNegocio, type OrigenNegocio } from "./negocios.ts";

export interface NegocioEmbudo {
  id: string;
  empresa: string;
  origen: OrigenNegocio;
  responsable: string | null;
  broker: string | null;
  /** ISO */
  creadoAt: string;
  etapa: EtapaNegocio;
  /** ISO */
  etapaDesde: string;
  /** Monto de referencia: el del crédito de SIAC, el aprobado, el ofrecido o el estimado. */
  monto: number | null;
}

export interface CambioEmbudo {
  negocioId: string;
  de: EtapaNegocio | null;
  a: EtapaNegocio;
  /** ISO */
  ocurridoAt: string;
}

const ORDEN = new Map(ETAPAS_NEGOCIO.map((e, i) => [e.value, i]));
const MS_DIA = 86_400_000;

/** Etapas del embudo, de Prospecto a Dispersado. */
export const ETAPAS_EMBUDO: EtapaNegocio[] = [...ETAPAS_ABIERTAS, "dispersado"];

/** Mediana de una lista de números (null si está vacía). */
export function mediana(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const o = [...xs].sort((a, b) => a - b);
  const m = Math.floor(o.length / 2);
  return o.length % 2 ? o[m] : (o[m - 1] + o[m]) / 2;
}

export interface Grupo {
  clave: string;
  entraron: number;
  dispersados: number;
  montoDispersado: number;
  abiertos: number;
  montoAbierto: number;
}

export interface Embudo {
  entraron: number;
  /** De los que entraron en el periodo, cuántos llegaron (al menos) a cada etapa. */
  llegaron: { etapa: EtapaNegocio; n: number }[];
  /** Días que pasan los negocios en cada etapa (estancias que terminaron en el periodo). */
  tiempos: { etapa: EtapaNegocio; mediana: number | null; n: number }[];
  dispersados: { n: number; monto: number };
  rechazados: number;
  /** Abiertos hoy, por etapa. */
  abiertos: { etapa: EtapaNegocio; n: number; monto: number }[];
  /** Abiertos con más de `diasAtorado` días en su etapa, del más viejo al más nuevo. */
  atorados: (NegocioEmbudo & { dias: number })[];
  porOrigen: Grupo[];
  porResponsable: Grupo[];
  porBroker: Grupo[];
}

/** Días completos entre dos momentos (como «hace N días» en la ficha). */
const dias = (desde: string, hasta: string) => Math.max(0, Math.floor((Date.parse(hasta) - Date.parse(desde)) / MS_DIA));

/**
 * Las métricas del periodo [desde, hasta]. `desde` y `hasta` son ISO; un
 * negocio dispersado o rechazado cuenta en el periodo de su último cambio a esa etapa.
 */
export function calcularEmbudo(p: { negocios: NegocioEmbudo[]; cambios: CambioEmbudo[]; desde: string; hasta: string; hoy: string; diasAtorado: number }): Embudo {
  const desde = Date.parse(p.desde);
  const hasta = Date.parse(p.hasta);
  const enPeriodo = (iso: string) => {
    const t = Date.parse(iso);
    return t >= desde && t <= hasta;
  };
  const porNegocio = new Map<string, CambioEmbudo[]>();
  for (const c of [...p.cambios].sort((a, b) => Date.parse(a.ocurridoAt) - Date.parse(b.ocurridoAt))) {
    const l = porNegocio.get(c.negocioId) ?? [];
    l.push(c);
    porNegocio.set(c.negocioId, l);
  }
  /** La etapa más avanzada del embudo que alcanzó (sin contar cierres). */
  const maxima = (n: NegocioEmbudo) => {
    let m = -1;
    for (const c of porNegocio.get(n.id) ?? []) if (ETAPAS_EMBUDO.includes(c.a)) m = Math.max(m, ORDEN.get(c.a)!);
    if (ETAPAS_EMBUDO.includes(n.etapa)) m = Math.max(m, ORDEN.get(n.etapa)!);
    return m;
  };
  /** Cuándo llegó por última vez a una etapa de cierre o a dispersado. */
  const ultimaVez = (n: NegocioEmbudo, etapa: EtapaNegocio) => {
    if (n.etapa !== etapa) return null;
    const l = (porNegocio.get(n.id) ?? []).filter((c) => c.a === etapa);
    return l.length ? l[l.length - 1].ocurridoAt : n.etapaDesde;
  };

  const cohorte = p.negocios.filter((n) => enPeriodo(n.creadoAt));
  const llegaron = ETAPAS_EMBUDO.map((etapa) => ({ etapa, n: cohorte.filter((n) => maxima(n) >= ORDEN.get(etapa)!).length }));

  const estancias = new Map<EtapaNegocio, number[]>();
  for (const l of porNegocio.values()) {
    for (let i = 0; i < l.length - 1; i++) {
      const etapa = l[i].a;
      if (!ETAPAS_ABIERTAS.includes(etapa) || !enPeriodo(l[i + 1].ocurridoAt)) continue;
      const xs = estancias.get(etapa) ?? [];
      xs.push(dias(l[i].ocurridoAt, l[i + 1].ocurridoAt));
      estancias.set(etapa, xs);
    }
  }
  const tiempos = ETAPAS_ABIERTAS.map((etapa) => ({ etapa, mediana: mediana(estancias.get(etapa) ?? []), n: (estancias.get(etapa) ?? []).length }));

  const dispersadosEn = p.negocios.filter((n) => {
    const t = ultimaVez(n, "dispersado");
    return t !== null && enPeriodo(t);
  });
  const rechazados = p.negocios.filter((n) => {
    const t = ultimaVez(n, "rechazado");
    return t !== null && enPeriodo(t);
  }).length;
  const abiertosHoy = p.negocios.filter((n) => ETAPAS_ABIERTAS.includes(n.etapa));
  const suma = (xs: NegocioEmbudo[]) => Math.round(xs.reduce((s, n) => s + (n.monto ?? 0), 0) * 100) / 100;

  const agrupar = (clave: (n: NegocioEmbudo) => string | null): Grupo[] => {
    const g = new Map<string, Grupo>();
    const de = (k: string) => {
      let x = g.get(k);
      if (!x) g.set(k, (x = { clave: k, entraron: 0, dispersados: 0, montoDispersado: 0, abiertos: 0, montoAbierto: 0 }));
      return x;
    };
    for (const n of cohorte) {
      const k = clave(n);
      if (k) de(k).entraron++;
    }
    for (const n of dispersadosEn) {
      const k = clave(n);
      if (!k) continue;
      de(k).dispersados++;
      de(k).montoDispersado = Math.round((de(k).montoDispersado + (n.monto ?? 0)) * 100) / 100;
    }
    for (const n of abiertosHoy) {
      const k = clave(n);
      if (!k) continue;
      de(k).abiertos++;
      de(k).montoAbierto = Math.round((de(k).montoAbierto + (n.monto ?? 0)) * 100) / 100;
    }
    return [...g.values()].sort((a, b) => b.montoDispersado - a.montoDispersado || b.entraron - a.entraron || a.clave.localeCompare(b.clave));
  };

  return {
    entraron: cohorte.length,
    llegaron,
    tiempos,
    dispersados: { n: dispersadosEn.length, monto: suma(dispersadosEn) },
    rechazados,
    abiertos: ETAPAS_ABIERTAS.map((etapa) => {
      const xs = abiertosHoy.filter((n) => n.etapa === etapa);
      return { etapa, n: xs.length, monto: suma(xs) };
    }),
    atorados: abiertosHoy
      // Igual que «hace N días» en la ficha y que el playbook: por fecha de México.
      .map((n) => ({ ...n, dias: diasEnEtapa(n.etapaDesde, p.hoy) }))
      .filter((n) => p.diasAtorado > 0 && n.dias > p.diasAtorado)
      .sort((a, b) => b.dias - a.dias),
    porOrigen: agrupar((n) => n.origen),
    porResponsable: agrupar((n) => n.responsable ?? "Sin responsable"),
    porBroker: agrupar((n) => n.broker),
  };
}

/** Periodos que se pueden elegir en la página. */
export const PERIODOS = [30, 90, 365] as const;
export type Periodo = (typeof PERIODOS)[number];
export const leerPeriodo = (v: unknown): Periodo => (PERIODOS.includes(Number(v) as Periodo) ? (Number(v) as Periodo) : 90);
