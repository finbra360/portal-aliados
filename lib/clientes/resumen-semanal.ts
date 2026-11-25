// Resumen semanal de originación para Slack (canal de onboarding): qué entró,
// qué avanzó, qué se dispersó o se cerró la semana pasada, cómo está el embudo
// hoy y qué hay que atender. Sale los lunes con la corrida de las 9:00.
// Funciones puras, sin base de datos, para probarlas con `node --test`.

import { ETAPAS_ABIERTAS, ETAPAS_NEGOCIO, ETIQUETA_ETAPA, ORIGENES_NEGOCIO, type EtapaNegocio, type OrigenNegocio } from "./negocios.ts";
import type { CambioEmbudo, Embudo, NegocioEmbudo } from "./embudo.ts";

const MS_DIA = 86_400_000;
const sumarDias = (fecha: string, n: number) => new Date(Date.parse(`${fecha}T12:00:00Z`) + n * MS_DIA).toISOString().slice(0, 10);

export interface Semana {
  /** Lunes, YYYY-MM-DD (hora de México). */
  desde: string;
  /** Domingo, YYYY-MM-DD. */
  hasta: string;
  /** Límites en ISO: México es UTC-6 todo el año desde 2022. */
  desdeIso: string;
  hastaIso: string;
}

/** La semana completa (lunes a domingo) anterior a la de `hoy`. */
export function semanaAnterior(hoy: string): Semana {
  const dia = new Date(`${hoy}T12:00:00Z`).getUTCDay(); // 0 = domingo
  const lunesDeHoy = sumarDias(hoy, -((dia + 6) % 7));
  return semanaDesde(sumarDias(lunesDeHoy, -7));
}

/** La semana que empieza el lunes `desde`. */
export function semanaDesde(desde: string): Semana {
  const hasta = sumarDias(desde, 6);
  return {
    desde,
    hasta,
    desdeIso: `${desde}T06:00:00.000Z`,
    hastaIso: new Date(Date.parse(`${sumarDias(desde, 7)}T06:00:00.000Z`) - 1).toISOString(),
  };
}

const ORDEN = new Map(ETAPAS_NEGOCIO.map((e, i) => [e.value, i]));
const AVANZA: EtapaNegocio[] = [...ETAPAS_ABIERTAS, "dispersado"];

/**
 * Lo que pasó en la semana que no está en el embudo: cuántas veces un negocio
 * pasó a una etapa más adelante (sin contar lo que puso el importador de
 * HubSpot) y cuáles se dispersaron.
 */
export function movimientosDeLaSemana(negocios: NegocioEmbudo[], cambios: CambioEmbudo[], s: Semana) {
  const dentro = (iso: string) => iso >= s.desdeIso && iso <= s.hastaIso;
  const avances = cambios.filter(
    (c) => !c.importado && c.de !== null && dentro(c.ocurridoAt) && AVANZA.includes(c.a) && (ORDEN.get(c.a) ?? 0) > (ORDEN.get(c.de) ?? 0),
  ).length;
  const dispersados = negocios
    .filter((n) => n.etapa === "dispersado" && dentro(n.etapaDesde))
    .map((n) => ({ empresa: n.empresa, monto: n.monto }))
    .sort((a, b) => (b.monto ?? 0) - (a.monto ?? 0));
  return { avances, dispersados };
}

export interface DatosResumen {
  semana: Semana;
  urlBase: string;
  actual: Pick<Embudo, "entraron" | "dispersados" | "rechazados" | "pospuestos" | "abiertos" | "atorados" | "porOrigen">;
  anterior: Pick<Embudo, "entraron" | "dispersados" | "rechazados">;
  avances: number;
  dispersados: { empresa: string; monto: number | null }[];
  diasAtorado: number;
  /** Negocios de origen broker sin broker. */
  brokersSinAsignar: number;
  /** Dispersados recientes sin ligar a su crédito de SIAC (null si la base no liga todavía). */
  sinLigar: number | null;
}

const peso = (n: number) => n.toLocaleString("es-MX", { style: "currency", currency: "MXN", maximumFractionDigits: 0 });
const plural = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`;
const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const fecha = (f: string, conAnio = false) => {
  const [y, m, d] = f.split("-").map(Number);
  return `${d} ${MESES[m - 1]}${conAnio ? ` ${y}` : ""}`;
};

/** «(semana anterior: 3)» o «(igual que la semana anterior)». */
function contra(actual: number, antes: number): string {
  return actual === antes ? "(igual que la semana anterior)" : `(semana anterior: ${antes})`;
}

/** Hasta `max` y «y N más». */
function lista<T>(xs: T[], max: number, f: (x: T) => string): string {
  const parte = xs.slice(0, max).map(f).join(" · ");
  return xs.length > max ? `${parte} y ${xs.length - max} más` : parte;
}

/** El mensaje para Slack (mrkdwn). */
export function armarResumen(d: DatosResumen): string {
  const a = d.actual;
  const l: string[] = [`*Originación — semana del ${fecha(d.semana.desde)} al ${fecha(d.semana.hasta, true)}*`, ""];

  // La semana.
  const origenes = a.porOrigen
    .filter((g) => g.entraron > 0)
    .sort((x, y) => y.entraron - x.entraron)
    .map((g) => `${ORIGENES_NEGOCIO[g.clave as OrigenNegocio] ?? g.clave} ${g.entraron}`);
  l.push(`• 📥 Entraron *${plural(a.entraron, "negocio", "negocios")}* ${contra(a.entraron, d.anterior.entraron)}${origenes.length ? ` — ${origenes.join(", ")}` : ""}`);
  l.push(`• ➡️ ${d.avances === 0 ? "Ningún negocio avanzó de etapa" : `*${plural(d.avances, "avance", "avances")}* de etapa`}`);
  if (a.dispersados.n > 0) {
    l.push(`• 💰 Se dispersaron *${a.dispersados.n}* por *${peso(a.dispersados.monto)}* ${contra(a.dispersados.n, d.anterior.dispersados.n)}`);
    if (d.dispersados.length) l.push(`    ${lista(d.dispersados, 5, (x) => `${x.empresa}${x.monto !== null ? ` ${peso(x.monto)}` : ""}`)}`);
  } else {
    l.push(`• 💰 Ningún dispersado ${contra(0, d.anterior.dispersados.n)}`);
  }
  const cierres = [a.rechazados ? plural(a.rechazados, "rechazado", "rechazados") : null, a.pospuestos ? plural(a.pospuestos, "pospuesto", "pospuestos") : null].filter(Boolean);
  if (cierres.length) l.push(`• 🚫 Se cerraron ${cierres.join(" y ")}`);

  // El embudo hoy.
  const abiertos = a.abiertos.filter((x) => x.n > 0);
  const totalAbiertos = abiertos.reduce((s, x) => s + x.n, 0);
  const montoAbierto = abiertos.reduce((s, x) => s + x.monto, 0);
  l.push("", `*Embudo abierto hoy:* ${plural(totalAbiertos, "negocio", "negocios")} · ${peso(montoAbierto)}`);
  if (abiertos.length) l.push(abiertos.map((x) => `${ETIQUETA_ETAPA[x.etapa]} ${x.n}`).join(" · "));

  // Qué atender.
  const atender: string[] = [];
  if (a.atorados.length) {
    atender.push(
      `• ⏳ ${plural(a.atorados.length, "negocio lleva", "negocios llevan")} más de ${d.diasAtorado} días en su etapa — ${lista(a.atorados, 3, (x) => `${x.empresa} (${x.dias} d en ${ETIQUETA_ETAPA[x.etapa]})`)}`,
    );
  }
  if (d.brokersSinAsignar) atender.push(`• 👥 ${plural(d.brokersSinAsignar, "negocio de broker no tiene", "negocios de broker no tienen")} broker asignado`);
  if (d.sinLigar) atender.push(`• 🔗 ${plural(d.sinLigar, "dispersado sin ligar", "dispersados sin ligar")} a su crédito de SIAC`);
  if (atender.length) l.push("", "*Para atender*", ...atender);

  l.push("", `<${d.urlBase}/backoffice/negocios/metricas|Ver métricas> · <${d.urlBase}/backoffice/negocios|Ver negocios>`);
  return l.join("\n");
}
