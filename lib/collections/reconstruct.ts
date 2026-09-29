// Reconstrucción de la historia de un crédito con fechas de corte pasadas.
// Función pura: recibe cómo pedir la foto de un día y regresa las fotos
// consultadas, con sus eventos y su `vencidoDesde`. No toca la base.

import { addDays, daysBetween, deriveDay, type DayState, type DerivedEvent } from "./rules.ts";

export type DayValues = Omit<DayState, "vencidoDesde">;

const CENTAVO = 0.005;
const igual = (a: number, b: number) => Math.abs(a - b) < CENTAVO;

/** Último día de cada mes estrictamente entre `desde` y `hasta`. */
export function monthEndsBetween(desde: string, hasta: string): string[] {
  const fechas: string[] = [];
  let [y, m] = desde.split("-").map(Number);
  for (;;) {
    const finDeMes = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10); // día 0 del mes siguiente
    if (finDeMes >= hasta) break;
    if (finDeMes > desde) fechas.push(finDeMes);
    m++;
    if (m > 12) {
      m = 1;
      y++;
    }
  }
  return fechas;
}

/**
 * Dos fotos son equivalentes si entre ellas no pudo pasar nada: mismas sumas
 * acumuladas (pagos, condonaciones, quitas, castigos) y el mismo estado de
 * vencido. Un atraso no se cura sin un pago o un ajuste, y un pago siempre
 * mueve la suma de pagos, así que si nada de eso cambió no hace falta
 * consultar los días intermedios.
 */
export function equivalentes(p: DayValues, q: DayValues): boolean {
  return (
    igual(p.sumaPagos, q.sumaPagos) &&
    igual(p.sumaCondonaciones, q.sumaCondonaciones) &&
    igual(p.sumaQuitas, q.sumaQuitas) &&
    igual(p.sumaCastigos, q.sumaCastigos) &&
    p.saldoVencido > CENTAVO === q.saldoVencido > CENTAVO
  );
}

export interface ReconstructResult {
  /** Todas las fotos, en orden, con `vencidoDesde` calculado. */
  estados: DayState[];
  eventos: DerivedEvent[];
  /** Fechas que hubo que pedir a SIAC (las de `conocidas` no cuentan). */
  consultadas: string[];
}

/**
 * 1. Pide la foto de `desde`, del cierre de cada mes y de `hasta`.
 * 2. Entre cada par de fotos que no son equivalentes, pide el día de en medio
 *    y repite hasta que cada cambio quede entre dos días seguidos. Así cada
 *    pago, entrada a vencido y regularización queda con su día exacto, aunque
 *    un atraso empiece y se pague dentro del mismo mes.
 * 3. Recorre todas las fotos en orden para sacar eventos y `vencidoDesde`.
 *
 * `conocidas` son fotos que ya tenemos (las de la sincronización diaria) y no
 * se vuelven a pedir.
 */
export async function reconstruct(
  desde: string,
  hasta: string,
  fetchDay: (fecha: string) => Promise<DayValues>,
  conocidas: DayValues[] = [],
): Promise<ReconstructResult> {
  const porFecha = new Map<string, DayValues>(conocidas.map((c) => [c.fechaCorte, c]));
  const consultadas: string[] = [];
  const obtener = async (fecha: string) => {
    let d = porFecha.get(fecha);
    if (!d) {
      d = await fetchDay(fecha);
      porFecha.set(fecha, d);
      consultadas.push(fecha);
    }
    return d;
  };

  const puntos = [...new Set([desde, ...monthEndsBetween(desde, hasta), hasta])].sort();
  const base: DayValues[] = [];
  for (const f of puntos) base.push(await obtener(f));

  const refinar = async (p: DayValues, q: DayValues): Promise<void> => {
    const dias = daysBetween(p.fechaCorte, q.fechaCorte);
    if (dias <= 1 || equivalentes(p, q)) return;
    const m = await obtener(addDays(p.fechaCorte, Math.floor(dias / 2)));
    await refinar(p, m);
    await refinar(m, q);
  };
  for (let i = 1; i < base.length; i++) await refinar(base[i - 1], base[i]);

  const ordenadas = [...porFecha.values()]
    .filter((d) => d.fechaCorte >= desde && d.fechaCorte <= hasta)
    .sort((a, b) => a.fechaCorte.localeCompare(b.fechaCorte));

  const estados: DayState[] = [];
  const eventos: DerivedEvent[] = [];
  let prev: DayState | null = null;
  for (const d of ordenadas) {
    // Entre fotos no consecutivas solo quedan pares equivalentes, así que
    // deriveDay no genera eventos falsos y la racha de vencido se conserva.
    const r = deriveDay(prev, d);
    eventos.push(...r.events);
    const estado: DayState = { ...d, vencidoDesde: r.vencidoDesde };
    estados.push(estado);
    prev = estado;
  }
  return { estados, eventos, consultadas };
}
