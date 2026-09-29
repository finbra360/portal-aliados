// Lectura de respuestas de SIAC. Sin dependencias para poder probarse con
// `node --test` directamente.

import type { ConsultarSaldoCreditoResponse } from "./types";

export class SiacParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SiacParseError";
  }
}

/**
 * Los servicios .asmx regresan el JSON como texto dentro de un XML:
 * <string xmlns="http://tempuri.org/">{...}</string>, con las entidades
 * escapadas. `&amp;` se decodifica al final para no convertir "&amp;quot;"
 * (un "&quot;" literal dentro del JSON) en comillas.
 */
export function parseAsmxJson<T>(texto: string): T {
  const match = texto.match(/<string[^>]*>([\s\S]*)<\/string>/);
  if (!match) {
    throw new SiacParseError(`Respuesta inesperada de SIAC: ${texto.slice(0, 200)}`);
  }
  const json = match[1]
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code)))
    .replace(/&amp;/g, "&");
  try {
    return JSON.parse(json) as T;
  } catch {
    throw new SiacParseError(`SIAC regresó JSON inválido: ${json.slice(0, 200)}`);
  }
}

/** SIAC manda fechas como "2025-06-20T00:00:00"; nosotros guardamos "2025-06-20". */
export function siacDate(valor: string | null | undefined): string | null {
  if (!valor) return null;
  const match = String(valor).match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : null;
}

const money = (n: unknown) => Math.round((Number(n) || 0) * 100) / 100;

/** Valores de una foto de saldo, con los nombres de columna de col_balance_snapshots. */
export interface SnapshotValues {
  saldoVigente: number;
  capitalVigente: number;
  ivaCapitalVigente: number;
  interesesVigentes: number;
  ivaInteresesVigentes: number;
  comisionesFuturas: number;
  ivaComisionesFuturas: number;
  saldoVencido: number;
  capitalVencido: number;
  ivaCapitalVencido: number;
  interesesVencidos: number;
  ivaInteresesVencidos: number;
  interesesMoratorios: number;
  ivaInteresesMoratorios: number;
  comisionesVencidas: number;
  ivaComisionesVencidas: number;
  saldoActual: number;
  totalPagar: number;
  saldoGlobal: number;
  cat: string | null;
  sumaMinistraciones: number;
  sumaPagos: number;
  sumaComisiones: number;
  sumaCondonaciones: number;
  sumaQuitas: number;
  sumaCastigos: number;
  fechaCalculoSiac: string | null;
}

export function toSnapshotValues(r: ConsultarSaldoCreditoResponse): SnapshotValues {
  const vig = r.SaldoVigente;
  const ven = r.SaldoVencido;
  const tot = r.Totales;
  const sum = r.Sumatorias;
  return {
    saldoVigente: money(vig.saldoVigente),
    capitalVigente: money(vig.CapitalVigente),
    ivaCapitalVigente: money(vig.IVACapitalVigente),
    interesesVigentes: money(vig.InteresesVigentes),
    ivaInteresesVigentes: money(vig.IVAInteresesVigentes),
    comisionesFuturas: money(vig.ComisionesFuturas),
    ivaComisionesFuturas: money(vig.IVAComisionesFuturas),
    saldoVencido: money(ven.saldoVencido),
    capitalVencido: money(ven.CapitalVencido),
    ivaCapitalVencido: money(ven.IVACapitalVencido),
    interesesVencidos: money(ven.InteresesVencidos),
    ivaInteresesVencidos: money(ven.IVAInteresesVencidos),
    interesesMoratorios: money(ven.InteresesMoratorios),
    ivaInteresesMoratorios: money(ven.IVAInteresesMoratorios),
    comisionesVencidas: money(ven.ComisionesVencidas),
    ivaComisionesVencidas: money(ven.IVAComisionesVencidas),
    saldoActual: money(tot.SaldoActual),
    totalPagar: money(tot.TotalPagar),
    saldoGlobal: money(tot.SaldoGlobal),
    cat: tot.CAT ?? null,
    sumaMinistraciones: money(sum.Ministraciones),
    sumaPagos: money(sum.Pagos),
    sumaComisiones: money(sum.Comisiones),
    sumaCondonaciones: money(sum.Condonaciones),
    sumaQuitas: money(sum.Quitas),
    sumaCastigos: money(sum.Castigos),
    fechaCalculoSiac: siacDate(r.Generales?.FechaCalculo),
  };
}
