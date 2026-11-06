// Radar de renovación: qué clientes califican para ofrecerles renovar cuando su
// crédito está por terminar, y qué tiene que hacer el radar cada día (abrir
// oportunidades, recordar a 60 y 30 días, cerrar las que ya no aplican).
// Funciones puras, sin base de datos, para probarlas con `node --test`.
//
// Una oportunidad solo autoriza a contactar al cliente. No es una aprobación de
// crédito y el monto de referencia no se le comunica como oferta.

import { estaEnMora } from "../collections/rules.ts";

export interface AjustesRenovacion {
  activo: boolean;
  /** Días antes del fin del plazo: en la mayor se abre la oportunidad; en las demás se recuerda. */
  ventanas: number[];
  /** Peor atraso histórico permitido (días). */
  atrasoMaximoHistorico: number;
  /** Veces en mora permitidas. */
  vecesMoraMax: number;
}

export const AJUSTES_RENOVACION_DEFAULT: AjustesRenovacion = { activo: true, ventanas: [90, 60, 30], atrasoMaximoHistorico: 15, vecesMoraMax: 2 };

const entero = (v: unknown, def: number) => (Number.isInteger(Number(v)) && Number(v) >= 0 ? Number(v) : def);

/** Lee el ajuste `renovaciones` de crm_settings; lo que falte o no sirva queda con el valor por omisión. */
export function leerAjustesRenovacion(raw: unknown): AjustesRenovacion {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const d = AJUSTES_RENOVACION_DEFAULT;
  const ventanas = Array.isArray(r.ventanas) ? [...new Set(r.ventanas.map(Number).filter((n) => Number.isInteger(n) && n > 0 && n <= 365))].sort((a, b) => b - a) : [];
  return {
    activo: typeof r.activo === "boolean" ? r.activo : d.activo,
    ventanas: ventanas.length ? ventanas : d.ventanas,
    atrasoMaximoHistorico: entero(r.atraso_maximo_historico, d.atrasoMaximoHistorico),
    vecesMoraMax: entero(r.veces_mora_max, d.vecesMoraMax),
  };
}

export interface CreditoRenovacion {
  creditId: string;
  empresaId: string;
  noCredito: string;
  /** false = salió del listado de SIAC. */
  enListado: boolean;
  fechaTermino: string | null;
  montoCredito: number | null;
  /** De la foto de hoy; null si el crédito no viene en ella. */
  atraso: number | null;
  vencido: number | null;
  atrasoMaximo: number | null;
  vecesMora: number | null;
  etapaManual: string | null;
  cubiertos: number | null;
  vencimientos: number | null;
}

export const diasParaFin = (fechaTermino: string, hoy: string) => Math.round((Date.parse(fechaTermino) - Date.parse(hoy)) / 86_400_000);

/** La ventana en la que está un crédito que termina en `dias`: la más chica que todavía lo cubre. */
export function ventanaDe(dias: number, ventanas: number[]): number | null {
  if (dias < 0) return null;
  const cubren = ventanas.filter((v) => dias <= v);
  return cubren.length ? Math.min(...cubren) : null;
}

const ETAPA_BLOQUEA: Record<string, string> = {
  juridico: "Está en jurídico",
  extrajudicial: "Está en cobranza extrajudicial",
  reestructura: "Está en reestructura",
  pausado: "Tiene la cobranza en pausa",
};

const plural = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`;
const FECHA = new Intl.DateTimeFormat("es-MX", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
export const fechaCorta = (iso: string) => FECHA.format(new Date(`${iso}T00:00:00Z`)).replace(".", "");

export type Evaluacion = { califica: true; razones: string[] } | { califica: false; motivos: string[] };

/**
 * ¿Califica la empresa para que se le ofrezca renovar este crédito? Revisa todos
 * sus créditos vigentes: sin atraso hoy, peor atraso y veces en mora dentro de
 * lo permitido, y ninguno en jurídico, extrajudicial, reestructura ni pausa.
 * Si no califica, dice por qué; si califica, por qué sí.
 */
export function evaluarRenovacion(credito: CreditoRenovacion, vigentesEmpresa: CreditoRenovacion[], a: AjustesRenovacion, hoy: string): Evaluacion {
  const motivos: string[] = [];
  const vigentes = vigentesEmpresa.filter((c) => c.enListado);
  if (vigentes.some((c) => c.atraso === null)) motivos.push("Algún crédito no viene en la foto de hoy");
  const atraso = Math.max(0, ...vigentes.map((c) => c.atraso ?? 0));
  const peor = Math.max(0, ...vigentes.map((c) => c.atrasoMaximo ?? 0));
  const veces = Math.max(0, ...vigentes.map((c) => c.vecesMora ?? 0));
  if (atraso > 0) motivos.push(`Tiene ${plural(atraso, "día", "días")} de atraso`);
  if (peor > a.atrasoMaximoHistorico) motivos.push(`Su peor atraso fue de ${plural(peor, "día", "días")} (máximo ${a.atrasoMaximoHistorico})`);
  if (veces > a.vecesMoraMax) motivos.push(`Cayó en mora ${plural(veces, "vez", "veces")} (máximo ${a.vecesMoraMax})`);
  for (const e of new Set(vigentes.map((c) => c.etapaManual).filter((e): e is string => !!e && e in ETAPA_BLOQUEA))) motivos.push(ETAPA_BLOQUEA[e]);
  if (motivos.length) return { califica: false, motivos };

  const razones = ["Al corriente en todos sus créditos"];
  razones.push(veces === 0 && peor === 0 ? "Nunca ha caído en mora" : `Cayó en mora ${plural(veces, "vez", "veces")}; peor atraso de ${plural(peor, "día", "días")}`);
  if (credito.cubiertos !== null && credito.vencimientos) razones.push(`${credito.cubiertos} de ${credito.vencimientos} mensualidades pagadas`);
  if (credito.fechaTermino) {
    const d = diasParaFin(credito.fechaTermino, hoy);
    razones.push(`El crédito ${credito.noCredito} termina el ${fechaCorta(credito.fechaTermino)} (en ${plural(d, "día", "días")})`);
  }
  return { califica: true, razones };
}

export type EstadoOportunidad = "abierta" | "en_contacto" | "interesado" | "ganada" | "descartada" | "cerrada";

export const ESTADOS_OPORTUNIDAD: Record<EstadoOportunidad, string> = {
  abierta: "Nueva",
  en_contacto: "En contacto",
  interesado: "Interesado",
  ganada: "Pasó a análisis",
  descartada: "Descartada",
  cerrada: "Cerrada por el radar",
};

/** Estados en los que la oportunidad sigue viva. */
export const ESTADOS_ABIERTOS: EstadoOportunidad[] = ["abierta", "en_contacto", "interesado"];
export const estaAbierta = (e: EstadoOportunidad) => ESTADOS_ABIERTOS.includes(e);

/** A qué estado puede pasar una persona (el radar es el único que usa «cerrada»). */
export const ESTADOS_MANUALES: EstadoOportunidad[] = ["en_contacto", "interesado", "ganada", "descartada"];

export function validarCambioOportunidad(
  actual: EstadoOportunidad,
  nuevo: string,
  motivo: string,
): { ok: true; estado: EstadoOportunidad; motivo: string | null } | { ok: false; error: string } {
  if (!estaAbierta(actual)) return { ok: false, error: "Esta oportunidad ya está cerrada." };
  if (!ESTADOS_MANUALES.includes(nuevo as EstadoOportunidad)) return { ok: false, error: "Estado no válido." };
  if (nuevo === actual) return { ok: false, error: "La oportunidad ya está en ese estado." };
  const m = motivo.trim();
  if (m.length > 1000) return { ok: false, error: "El motivo es demasiado largo (máximo 1,000 caracteres)." };
  if (nuevo === "descartada" && !m) return { ok: false, error: "Escribe por qué se descarta." };
  return { ok: true, estado: nuevo as EstadoOportunidad, motivo: m || null };
}

export interface OportunidadRadar {
  id: string;
  empresaId: string;
  creditId: string | null;
  estado: EstadoOportunidad;
}

export type AccionRadar =
  | { tipo: "abrir"; credito: CreditoRenovacion; razones: string[]; ventana: number }
  | { tipo: "recordar"; oportunidadId: string; credito: CreditoRenovacion; ventana: number }
  | { tipo: "cerrar"; oportunidadId: string; empresaId: string; motivo: string };

/**
 * Lo que el radar hace hoy, con la foto de hoy:
 * - cierra las oportunidades abiertas cuyo crédito salió del listado o cuya empresa cayó en mora;
 * - recuerda (una tarea por ventana) las que siguen abiertas;
 * - abre una nueva para el crédito vigente que entra en la ventana mayor y califica,
 *   si ese crédito nunca tuvo una y la empresa no tiene otra abierta.
 * Es idempotente: correrlo dos veces el mismo día no duplica nada (las tareas
 * se deduplican en la base por oportunidad y ventana).
 */
export function planRadar(p: {
  creditos: CreditoRenovacion[];
  oportunidades: OportunidadRadar[];
  ajustes: AjustesRenovacion;
  umbralMora: number;
  hoy: string;
}): AccionRadar[] {
  const { ajustes: a, hoy } = p;
  const porId = new Map(p.creditos.map((c) => [c.creditId, c]));
  const vigentesPorEmpresa = new Map<string, CreditoRenovacion[]>();
  for (const c of p.creditos.filter((c) => c.enListado)) vigentesPorEmpresa.set(c.empresaId, [...(vigentesPorEmpresa.get(c.empresaId) ?? []), c]);
  const enMora = (empresaId: string) => {
    const v = vigentesPorEmpresa.get(empresaId) ?? [];
    const vencido = v.reduce((s, c) => s + (c.vencido ?? 0), 0);
    const atraso = Math.max(0, ...v.map((c) => c.atraso ?? 0));
    return v.length > 0 && estaEnMora(vencido, atraso, p.umbralMora);
  };

  const acciones: AccionRadar[] = [];
  const conAbierta = new Set<string>();
  for (const o of p.oportunidades.filter((o) => estaAbierta(o.estado))) {
    const c = o.creditId ? porId.get(o.creditId) : undefined;
    if (!c || !c.enListado) {
      acciones.push({ tipo: "cerrar", oportunidadId: o.id, empresaId: o.empresaId, motivo: "El crédito salió del listado de SIAC" });
      continue;
    }
    if (enMora(o.empresaId)) {
      acciones.push({ tipo: "cerrar", oportunidadId: o.id, empresaId: o.empresaId, motivo: "La empresa cayó en mora" });
      continue;
    }
    conAbierta.add(o.empresaId);
    const ventana = c.fechaTermino ? ventanaDe(diasParaFin(c.fechaTermino, hoy), a.ventanas) : null;
    if (ventana !== null) acciones.push({ tipo: "recordar", oportunidadId: o.id, credito: c, ventana });
  }

  if (!a.activo) return acciones.filter((x) => x.tipo === "cerrar");

  const yaTuvieron = new Set(p.oportunidades.map((o) => o.creditId).filter(Boolean));
  const mayor = Math.max(...a.ventanas);
  const candidatos = p.creditos
    .filter((c) => c.enListado && c.fechaTermino && !yaTuvieron.has(c.creditId))
    .map((c) => ({ c, dias: diasParaFin(c.fechaTermino!, hoy) }))
    .filter((x) => x.dias >= 0 && x.dias <= mayor)
    .sort((x, y) => x.dias - y.dias || x.c.noCredito.localeCompare(y.c.noCredito));
  for (const { c, dias } of candidatos) {
    if (conAbierta.has(c.empresaId)) continue;
    const ev = evaluarRenovacion(c, vigentesPorEmpresa.get(c.empresaId) ?? [], a, hoy);
    if (!ev.califica) continue;
    acciones.push({ tipo: "abrir", credito: c, razones: ev.razones, ventana: ventanaDe(dias, a.ventanas)! });
    conAbierta.add(c.empresaId);
  }
  return acciones;
}

/**
 * La tarea que el radar deja para cada ventana de una oportunidad. La primera
 * (al abrirla, aunque ya esté en una ventana chica) es ofrecer la renovación.
 */
export function tareaDeVentana(
  ventana: number,
  ventanas: number[],
  c: CreditoRenovacion,
  nueva: boolean,
): { titulo: string; tipo: "llamada" | "seguimiento"; descripcion: string } {
  const fin = c.fechaTermino ? fechaCorta(c.fechaTermino) : "sin fecha";
  const aviso = "Oportunidad preliminar: no es una aprobación de crédito ni una oferta de monto.";
  if (nueva || ventana === Math.max(...ventanas)) {
    return { titulo: `Ofrecer renovación: el crédito ${c.noCredito} termina el ${fin}`, tipo: "llamada", descripcion: aviso };
  }
  return { titulo: `Renovación: faltan ${ventana} días o menos para que termine el crédito ${c.noCredito} (${fin})`, tipo: "seguimiento", descripcion: aviso };
}
