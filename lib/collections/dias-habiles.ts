// Días hábiles para los recordatorios de cobranza: salen de lunes a viernes,
// sin los días inhábiles bancarios (calendario CNBV, el mismo que usa el
// recordatorio de la TIIE en n8n). Lo que tocaría en un día inhábil se adelanta
// al día hábil anterior. Función pura, sin base de datos.

import { addDays } from "./rules.ts";

/** Días inhábiles bancarios entre semana (CNBV). Revisar cada año, junto con el nodo de n8n "Recordatorio TIIE SIAC". */
export const INHABILES = new Set([
  "2026-11-02", "2026-11-16", "2026-12-12", "2026-12-25",
  "2027-01-01", "2027-02-01", "2027-03-15", "2027-03-25", "2027-03-26", "2027-05-01",
  "2027-09-16", "2027-11-02", "2027-11-15", "2027-12-12", "2027-12-25",
]);

/** Fecha YYYY-MM-DD. */
export function esDiaHabil(fecha: string): boolean {
  const dia = new Date(`${fecha}T00:00:00Z`).getUTCDay();
  return dia !== 0 && dia !== 6 && !INHABILES.has(fecha);
}

/**
 * Los días que cubre el envío de hoy: hoy y los inhábiles que le siguen (el
 * viernes cubre sábado y domingo). Vacío si hoy es inhábil: ese día no sale nada.
 */
export function diasCubiertos(hoy: string): string[] {
  if (!esDiaHabil(hoy)) return [];
  const dias = [hoy];
  for (let d = addDays(hoy, 1); !esDiaHabil(d) && dias.length < 10; d = addDays(d, 1)) dias.push(d);
  return dias;
}

export const MOTIVO_DIA_INHABIL = "Hoy no es día hábil: los recordatorios salen de lunes a viernes (lo del fin de semana se adelanta al viernes)";
