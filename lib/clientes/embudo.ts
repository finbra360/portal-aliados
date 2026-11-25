// Métricas del embudo de originación: cuántos negocios entran, hasta dónde
// llegan, cuánto tardan en cada etapa y del alta a la dispersión, cuáles están
// atorados, cuánto se dispersa y con qué ticket, por qué se rechazan, qué tan
// probable es que cierre cada etapa (con la historia) y el mismo resumen por
// trimestre. Salen del historial de etapas (crm_negocio_etapas). Funciones
// puras, sin base de datos, para probarlas con `node --test`.

import { ETAPAS_ABIERTAS, ETAPAS_NEGOCIO, MOTIVOS_RECHAZO, PRODUCTOS, diasEnEtapa, type EtapaNegocio, type OrigenNegocio, type Producto } from "./negocios.ts";

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
  producto?: Producto | null;
  /** Clave de MOTIVOS_RECHAZO (los traídos de HubSpot no la tienen). */
  rechazoMotivo?: string | null;
  rechazoPor?: "finbra" | "cliente" | null;
}

export interface CambioEmbudo {
  negocioId: string;
  de: EtapaNegocio | null;
  a: EtapaNegocio;
  /** ISO */
  ocurridoAt: string;
  /**
   * Lo puso el importador de HubSpot: salta del alta a la etapa (o al cierre)
   * sin las de en medio, así que no dice cuánto tardó ni por dónde pasó.
   */
  importado?: boolean;
}

const ORDEN = new Map(ETAPAS_NEGOCIO.map((e, i) => [e.value, i]));
const MS_DIA = 86_400_000;
const CIERRES_FINALES: EtapaNegocio[] = ["dispersado", "rechazado", "pospuesto"];

/** Etapas del embudo, de Prospecto a Dispersado. */
export const ETAPAS_EMBUDO: EtapaNegocio[] = [...ETAPAS_ABIERTAS, "dispersado"];

/** Mediana de una lista de números (null si está vacía). */
export function mediana(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const o = [...xs].sort((a, b) => a - b);
  const m = Math.floor(o.length / 2);
  return o.length % 2 ? o[m] : (o[m - 1] + o[m]) / 2;
}

/** Percentil (0–100) con interpolación lineal; null si está vacía. */
export function percentil(xs: number[], p: number): number | null {
  if (xs.length === 0) return null;
  const o = [...xs].sort((a, b) => a - b);
  const i = ((o.length - 1) * p) / 100;
  const b = Math.floor(i);
  return o[b] + (o[Math.min(b + 1, o.length - 1)] - o[b]) * (i - b);
}

const promedio = (xs: number[]) => (xs.length ? Math.round((xs.reduce((s, x) => s + x, 0) / xs.length) * 10) / 10 : null);
const redondear = (n: number) => Math.round(n * 100) / 100;
const proporcion = (a: number, b: number) => (b > 0 ? a / b : null);

/** Fecha de México (YYYY-MM-DD) de un momento ISO. */
const FECHA_MX = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Mexico_City" });
export const fechaMx = (iso: string) => FECHA_MX.format(new Date(iso));

/** Días completos entre dos momentos (como «hace N días» en la ficha). */
const dias = (desde: string, hasta: string) => Math.max(0, Math.floor((Date.parse(hasta) - Date.parse(desde)) / MS_DIA));

/** Historial ordenado por negocio, con lo que se pregunta seguido. */
function indexar(negocios: NegocioEmbudo[], cambios: CambioEmbudo[]) {
  const porNegocio = new Map<string, CambioEmbudo[]>();
  for (const c of [...cambios].sort((a, b) => Date.parse(a.ocurridoAt) - Date.parse(b.ocurridoAt))) {
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
  /** Cuándo llegó por última vez a la etapa en que está hoy (dispersado, rechazado, pospuesto…); null si no está ahí. */
  const ultimaVez = (n: NegocioEmbudo, etapa: EtapaNegocio) => {
    if (n.etapa !== etapa) return null;
    const l = (porNegocio.get(n.id) ?? []).filter((c) => c.a === etapa);
    return l.length ? l[l.length - 1].ocurridoAt : n.etapaDesde;
  };
  /** Pasó de verdad por la etapa: tiene un cambio a ella (todos pasan por Prospecto al darse de alta). */
  const pasoPor = (n: NegocioEmbudo, etapa: EtapaNegocio) => etapa === "prospecto" || (porNegocio.get(n.id) ?? []).some((c) => c.a === etapa);
  return { porNegocio, maxima, ultimaVez, pasoPor };
}

export interface Grupo {
  clave: string;
  /** Dados de alta en el periodo. */
  entraron: number;
  /** Dispersados en el periodo (sin importar cuándo entraron). */
  dispersados: number;
  montoDispersado: number;
  /** Monto dispersado entre dispersados; null sin dispersados. */
  ticket: number | null;
  /** De los que entraron en el periodo, la parte que ya se dispersó. */
  conversion: number | null;
  abiertos: number;
  montoAbierto: number;
}

export interface TiempoEtapa {
  etapa: EtapaNegocio;
  mediana: number | null;
  promedio: number | null;
  /** Tres de cada cuatro salen antes de estos días. */
  p75: number | null;
  n: number;
}

export interface Probabilidad {
  etapa: EtapaNegocio;
  /** Negocios ya cerrados (dispersados, rechazados o pospuestos) que llegaron al menos a esta etapa. */
  base: number;
  dispersados: number;
  /** null con menos de MIN_BASE cerrados: muy pocos para decir algo. */
  p: number | null;
}

/** Cerrados mínimos para calcular la probabilidad de una etapa. */
export const MIN_BASE = 5;

export interface Embudo {
  entraron: number;
  /** De los que entraron en el periodo, cuántos llegaron (al menos) a cada etapa. */
  llegaron: { etapa: EtapaNegocio; n: number }[];
  /** De los que entraron en el periodo, la parte que ya se dispersó. */
  conversion: number | null;
  /** Días que pasan los negocios en cada etapa (estancias que terminaron en el periodo). */
  tiempos: TiempoEtapa[];
  dispersados: {
    n: number;
    monto: number;
    ticket: number | null;
    /** Días del alta a la dispersión (mediana) de los dispersados en el periodo. */
    ciclo: number | null;
    cicloP75: number | null;
  };
  rechazados: number;
  rechazos: { finbra: number; cliente: number; sinDato: number; motivos: { clave: string; label: string; n: number }[] };
  pospuestos: number;
  /** Abiertos hoy, por etapa. */
  abiertos: { etapa: EtapaNegocio; n: number; monto: number }[];
  /** Abiertos con más de `diasAtorado` días en su etapa, del más viejo al más nuevo. */
  atorados: (NegocioEmbudo & { dias: number })[];
  /** Con toda la historia (no solo el periodo): qué tan probable es que se disperse un negocio que llegó a cada etapa. */
  probabilidades: Probabilidad[];
  /** Monto abierto hoy por la probabilidad de su etapa. */
  pronostico: { monto: number; cubierto: number };
  porOrigen: Grupo[];
  porResponsable: Grupo[];
  porBroker: Grupo[];
  porProducto: Grupo[];
}

/**
 * Las métricas del periodo [desde, hasta]. `desde` y `hasta` son ISO; un
 * negocio dispersado, rechazado o pospuesto cuenta en el periodo de su último
 * cambio a esa etapa.
 */
export function calcularEmbudo(p: { negocios: NegocioEmbudo[]; cambios: CambioEmbudo[]; desde: string; hasta: string; hoy: string; diasAtorado: number }): Embudo {
  const desde = Date.parse(p.desde);
  const hasta = Date.parse(p.hasta);
  const enPeriodo = (iso: string) => {
    const t = Date.parse(iso);
    return t >= desde && t <= hasta;
  };
  const { porNegocio, maxima, ultimaVez, pasoPor } = indexar(p.negocios, p.cambios);
  const cerradoEn = (etapa: EtapaNegocio) =>
    p.negocios.filter((n) => {
      const t = ultimaVez(n, etapa);
      return t !== null && enPeriodo(t);
    });

  const cohorte = p.negocios.filter((n) => enPeriodo(n.creadoAt));
  const llegaron = ETAPAS_EMBUDO.map((etapa) => ({ etapa, n: cohorte.filter((n) => maxima(n) >= ORDEN.get(etapa)!).length }));

  const estancias = new Map<EtapaNegocio, number[]>();
  for (const l of porNegocio.values()) {
    for (let i = 0; i < l.length - 1; i++) {
      const etapa = l[i].a;
      // Un salto del importador no es tiempo real en la etapa.
      if (!ETAPAS_ABIERTAS.includes(etapa) || !enPeriodo(l[i + 1].ocurridoAt) || l[i + 1].importado) continue;
      const xs = estancias.get(etapa) ?? [];
      xs.push(dias(l[i].ocurridoAt, l[i + 1].ocurridoAt));
      estancias.set(etapa, xs);
    }
  }
  const tiempos = ETAPAS_ABIERTAS.map((etapa) => {
    const xs = estancias.get(etapa) ?? [];
    return { etapa, mediana: mediana(xs), promedio: promedio(xs), p75: percentil(xs, 75), n: xs.length };
  });

  const dispersadosEn = cerradoEn("dispersado");
  const rechazadosEn = cerradoEn("rechazado");
  const suma = (xs: NegocioEmbudo[]) => redondear(xs.reduce((s, n) => s + (n.monto ?? 0), 0));
  const ciclos = dispersadosEn.map((n) => dias(n.creadoAt, ultimaVez(n, "dispersado")!));
  const abiertosHoy = p.negocios.filter((n) => ETAPAS_ABIERTAS.includes(n.etapa));

  const motivos = new Map<string, number>();
  for (const n of rechazadosEn) motivos.set(n.rechazoMotivo ?? "", (motivos.get(n.rechazoMotivo ?? "") ?? 0) + 1);

  // Probabilidad de dispersar desde cada etapa, con todos los negocios ya
  // cerrados que pasaron de verdad por ella (los cerrados traídos de HubSpot
  // solo cuentan en Prospecto: no se sabe por qué etapas pasaron).
  const cerrados = p.negocios.filter((n) => CIERRES_FINALES.includes(n.etapa));
  const probabilidades = ETAPAS_ABIERTAS.map((etapa) => {
    const base = cerrados.filter((n) => pasoPor(n, etapa));
    const ganados = base.filter((n) => n.etapa === "dispersado").length;
    return { etapa, base: base.length, dispersados: ganados, p: base.length >= MIN_BASE ? ganados / base.length : null };
  });
  const probDe = new Map(probabilidades.map((x) => [x.etapa, x.p]));
  let pronostico = 0;
  let cubierto = 0;
  for (const n of abiertosHoy) {
    const pr = probDe.get(n.etapa);
    if (pr === null || pr === undefined || n.monto === null) continue;
    pronostico += n.monto * pr;
    cubierto += n.monto;
  }

  const agrupar = (clave: (n: NegocioEmbudo) => string | null): Grupo[] => {
    const g = new Map<string, Grupo & { ganadosCohorte: number }>();
    const de = (k: string) => {
      let x = g.get(k);
      if (!x) g.set(k, (x = { clave: k, entraron: 0, dispersados: 0, montoDispersado: 0, ticket: null, conversion: null, abiertos: 0, montoAbierto: 0, ganadosCohorte: 0 }));
      return x;
    };
    for (const n of cohorte) {
      const k = clave(n);
      if (!k) continue;
      de(k).entraron++;
      if (n.etapa === "dispersado") de(k).ganadosCohorte++;
    }
    for (const n of dispersadosEn) {
      const k = clave(n);
      if (!k) continue;
      de(k).dispersados++;
      de(k).montoDispersado = redondear(de(k).montoDispersado + (n.monto ?? 0));
    }
    for (const n of abiertosHoy) {
      const k = clave(n);
      if (!k) continue;
      de(k).abiertos++;
      de(k).montoAbierto = redondear(de(k).montoAbierto + (n.monto ?? 0));
    }
    return [...g.values()]
      .map(({ ganadosCohorte, ...x }) => ({
        ...x,
        ticket: x.dispersados ? redondear(x.montoDispersado / x.dispersados) : null,
        conversion: proporcion(ganadosCohorte, x.entraron),
      }))
      .sort((a, b) => b.montoDispersado - a.montoDispersado || b.entraron - a.entraron || a.clave.localeCompare(b.clave));
  };

  const montoDisp = suma(dispersadosEn);
  return {
    entraron: cohorte.length,
    llegaron,
    conversion: proporcion(cohorte.filter((n) => n.etapa === "dispersado").length, cohorte.length),
    tiempos,
    dispersados: {
      n: dispersadosEn.length,
      monto: montoDisp,
      ticket: dispersadosEn.length ? redondear(montoDisp / dispersadosEn.length) : null,
      ciclo: mediana(ciclos),
      cicloP75: percentil(ciclos, 75),
    },
    rechazados: rechazadosEn.length,
    rechazos: {
      finbra: rechazadosEn.filter((n) => n.rechazoPor === "finbra").length,
      cliente: rechazadosEn.filter((n) => n.rechazoPor === "cliente").length,
      sinDato: rechazadosEn.filter((n) => !n.rechazoPor).length,
      motivos: [...motivos.entries()]
        .map(([clave, n]) => ({ clave, label: clave ? (MOTIVOS_RECHAZO[clave]?.label ?? clave) : "Sin motivo (traídos de HubSpot)", n }))
        .sort((a, b) => b.n - a.n || a.label.localeCompare(b.label)),
    },
    pospuestos: cerradoEn("pospuesto").length,
    abiertos: ETAPAS_ABIERTAS.map((etapa) => {
      const xs = abiertosHoy.filter((n) => n.etapa === etapa);
      return { etapa, n: xs.length, monto: suma(xs) };
    }),
    atorados: abiertosHoy
      // Igual que «hace N días» en la ficha y que el playbook: por fecha de México.
      .map((n) => ({ ...n, dias: diasEnEtapa(n.etapaDesde, p.hoy) }))
      .filter((n) => p.diasAtorado > 0 && n.dias > p.diasAtorado)
      .sort((a, b) => b.dias - a.dias),
    probabilidades,
    pronostico: { monto: redondear(pronostico), cubierto: redondear(cubierto) },
    porOrigen: agrupar((n) => n.origen),
    porResponsable: agrupar((n) => n.responsable ?? "Sin responsable"),
    porBroker: agrupar((n) => n.broker),
    porProducto: agrupar((n) => (n.producto ? PRODUCTOS[n.producto] : "Sin producto")),
  };
}

// ---------------------------------------------------------------- trimestres

export interface Trimestre {
  /** «2026-Q3» */
  clave: string;
  /** «Q3 2026» */
  etiqueta: string;
  anio: number;
  q: 1 | 2 | 3 | 4;
  /** YYYY-MM-DD, inclusivo. */
  desde: string;
  /** YYYY-MM-DD, exclusivo. */
  hasta: string;
  /** El trimestre de hoy (va a medias). */
  enCurso: boolean;
  entraron: number;
  dispersados: number;
  montoDispersado: number;
  ticket: number | null;
  /** Días del alta a la dispersión (mediana) de los dispersados del trimestre. */
  ciclo: number | null;
  rechazados: number;
  pospuestos: number;
  /** De los que entraron en el trimestre, la parte que ya se dispersó (sigue subiendo mientras haya abiertos). */
  conversion: number | null;
  /** Monto dispersado contra el trimestre anterior (0.25 = 25 % más); null si el anterior fue 0. */
  variacion: number | null;
}

const inicioTrimestre = (anio: number, q: number) => `${anio}-${String((q - 1) * 3 + 1).padStart(2, "0")}-01`;

/**
 * Los últimos `cuantos` trimestres de calendario hasta el de `hoy`, del más
 * viejo al más nuevo. Cada evento cuenta en el trimestre de su fecha en México.
 */
export function porTrimestre(p: { negocios: NegocioEmbudo[]; cambios: CambioEmbudo[]; hoy: string; cuantos?: number }): Trimestre[] {
  const cuantos = p.cuantos ?? 8;
  const { ultimaVez } = indexar(p.negocios, p.cambios);
  const [anioHoy, mesHoy] = p.hoy.split("-").map(Number);
  const qHoy = Math.floor((mesHoy - 1) / 3) + 1;
  const lista: { anio: number; q: number }[] = [];
  for (let i = cuantos - 1; i >= 0; i--) {
    const total = anioHoy * 4 + (qHoy - 1) - i;
    lista.push({ anio: Math.floor(total / 4), q: (total % 4) + 1 });
  }
  const enRango = (iso: string | null, a: string, b: string) => {
    if (!iso) return false;
    const f = fechaMx(iso);
    return f >= a && f < b;
  };
  const filas: Trimestre[] = [];
  for (const { anio, q } of lista) {
    const desde = inicioTrimestre(anio, q);
    const hasta = q === 4 ? inicioTrimestre(anio + 1, 1) : inicioTrimestre(anio, q + 1);
    const entraron = p.negocios.filter((n) => enRango(n.creadoAt, desde, hasta));
    const disp = p.negocios.filter((n) => enRango(ultimaVez(n, "dispersado"), desde, hasta));
    const monto = redondear(disp.reduce((s, n) => s + (n.monto ?? 0), 0));
    const anterior = filas[filas.length - 1];
    filas.push({
      clave: `${anio}-Q${q}`,
      etiqueta: `Q${q} ${anio}`,
      anio,
      q: q as 1 | 2 | 3 | 4,
      desde,
      hasta,
      enCurso: p.hoy >= desde && p.hoy < hasta,
      entraron: entraron.length,
      dispersados: disp.length,
      montoDispersado: monto,
      ticket: disp.length ? redondear(monto / disp.length) : null,
      ciclo: mediana(disp.map((n) => dias(n.creadoAt, ultimaVez(n, "dispersado")!))),
      rechazados: p.negocios.filter((n) => enRango(ultimaVez(n, "rechazado"), desde, hasta)).length,
      pospuestos: p.negocios.filter((n) => enRango(ultimaVez(n, "pospuesto"), desde, hasta)).length,
      conversion: proporcion(entraron.filter((n) => n.etapa === "dispersado").length, entraron.length),
      variacion: anterior && anterior.montoDispersado > 0 ? monto / anterior.montoDispersado - 1 : null,
    });
  }
  return filas;
}

/** Periodos que se pueden elegir en la página (0 = toda la historia). */
export const PERIODOS = [30, 90, 365, 0] as const;
export type Periodo = (typeof PERIODOS)[number];
export const leerPeriodo = (v: unknown): Periodo => (PERIODOS.includes(Number(v) as Periodo) ? (Number(v) as Periodo) : 90);
