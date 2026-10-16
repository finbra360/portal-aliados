import type { PorMes } from "./n8n.ts";

const MESES = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];

/** Año y mes (1-12) de una fecha YYYY-MM-DD. */
export function mesDeFecha(fecha: string): { anio: number; mesNum: number } {
  const [anio, mesNum] = fecha.split("-").map(Number);
  return { anio, mesNum };
}

/** Un número por mes de calendario, para poder restar meses sin pensar en el cambio de año. */
const indiceDeMes = (anio: number, mesNum: number) => anio * 12 + (mesNum - 1);

function indiceDe(p: PorMes): number {
  return indiceDeMes(p.anio, MESES.indexOf(p.mes) + 1);
}

function porIndice(indice: number): PorMes {
  const anio = Math.floor(indice / 12);
  return { anio, mes: MESES[indice % 12], monto: 0 };
}

/**
 * Mes en curso y mes anterior según el calendario (no "los dos últimos meses
 * con datos"). `porMes` solo trae los meses que tuvieron colocación, así que
 * un mes sin movimiento se regresa con monto 0.
 */
export function mesesDeCalendario(porMes: PorMes[], hoy: string): { actual: PorMes; anterior: PorMes } {
  const { anio, mesNum } = mesDeFecha(hoy);
  const i = indiceDeMes(anio, mesNum);
  const montos = new Map(porMes.map((p) => [indiceDe(p), p]));
  return {
    actual: montos.get(i) ?? porIndice(i),
    anterior: montos.get(i - 1) ?? porIndice(i - 1),
  };
}

/**
 * Meses de calendario seguidos con colocación. Cuenta hacia atrás desde el mes
 * en curso si ya colocó en él; si todavía no, desde el mes anterior (la racha
 * sigue viva hasta que termine el mes). Un mes sin colocación la corta.
 */
export function getCurrentStreak(porMes: PorMes[], hoy: string): number {
  const conColocacion = new Set(porMes.filter((p) => p.monto > 0).map(indiceDe));
  const { anio, mesNum } = mesDeFecha(hoy);
  const actual = indiceDeMes(anio, mesNum);

  let i = conColocacion.has(actual) ? actual : actual - 1;
  let racha = 0;
  while (conColocacion.has(i)) {
    racha += 1;
    i -= 1;
  }
  return racha;
}

export function getPeriodDelta(current: number, previous: number): number | null {
  if (previous <= 0) return null;
  return ((current - previous) / previous) * 100;
}
