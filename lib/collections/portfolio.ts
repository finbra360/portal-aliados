// Resumen de la cartera a partir de la foto del día. Función pura, sin base de
// datos, para poder probarla con `node --test`.

import { BUCKETS, addDays, bucketFor, daysBetween, type Bucket } from "./rules.ts";

export interface PhotoRow {
  creditId: string;
  clientId: string;
  cliente: string;
  noCredito: string;
  montoCredito: number | null;
  antiguedad: number;
  totalVencido: number;
  interesesMoratorios: number;
  totalAdeudo: number;
  totalGlobal: number;
  proximoVencimiento: string | null;
}

export interface PortfolioSummary {
  creditos: number;
  clientes: number;
  /** Suma de MontoCredito de los créditos del listado. */
  colocado: number;
  /** Suma de TotalAdeudo. Pendiente de que SIAC confirme qué incluye frente a TotalGlobal. */
  adeudo: number;
  vencido: number;
  moratorios: number;
  clientesEnMora: number;
  /** Vencido de los clientes en mora; lo que queda fuera son residuos bajo el umbral. */
  vencidoEnMora: number;
  /** vencido / adeudo, en 0..1. */
  pctVencido: number | null;
  /** Porción del adeudo en créditos con más de 30, 60 y 90 días de atraso, en 0..1. */
  par30: number | null;
  par60: number | null;
  par90: number | null;
  aging: { bucket: Bucket; creditos: number; vencido: number; adeudo: number }[];
  proximos: {
    en7: number;
    en15: number;
    en30: number;
    lista: { creditId: string; clientId: string; cliente: string; noCredito: string; fecha: string; enDias: number }[];
  };
  top: { clientId: string; cliente: string; adeudo: number; vencido: number; maxAntiguedad: number; creditos: number }[];
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const ratio = (a: number, b: number) => (b > 0 ? a / b : null);

export function summarizePortfolio(rows: PhotoRow[], umbral: number, fechaCorte: string, topN = 10): PortfolioSummary {
  const porCliente = new Map<string, { cliente: string; adeudo: number; vencido: number; maxAntiguedad: number; creditos: number }>();
  for (const r of rows) {
    const c = porCliente.get(r.clientId) ?? { cliente: r.cliente, adeudo: 0, vencido: 0, maxAntiguedad: 0, creditos: 0 };
    c.adeudo += r.totalAdeudo;
    c.vencido += r.totalVencido;
    c.maxAntiguedad = Math.max(c.maxAntiguedad, r.antiguedad);
    c.creditos++;
    porCliente.set(r.clientId, c);
  }

  const adeudo = rows.reduce((s, r) => s + r.totalAdeudo, 0);
  const vencido = rows.reduce((s, r) => s + r.totalVencido, 0);
  const par = (dias: number) => ratio(rows.filter((r) => r.antiguedad > dias).reduce((s, r) => s + r.totalAdeudo, 0), adeudo);
  const enMora = [...porCliente.values()].filter((c) => c.vencido >= umbral);

  const aging = BUCKETS.map((bucket) => {
    const suyos = rows.filter((r) => bucketFor(r.antiguedad) === bucket);
    return {
      bucket,
      creditos: suyos.length,
      vencido: r2(suyos.reduce((s, r) => s + r.totalVencido, 0)),
      adeudo: r2(suyos.reduce((s, r) => s + r.totalAdeudo, 0)),
    };
  });

  const limite = addDays(fechaCorte, 30);
  const lista = rows
    .filter((r) => r.proximoVencimiento && r.proximoVencimiento >= fechaCorte && r.proximoVencimiento <= limite)
    .map((r) => ({
      creditId: r.creditId,
      clientId: r.clientId,
      cliente: r.cliente,
      noCredito: r.noCredito,
      fecha: r.proximoVencimiento!,
      enDias: daysBetween(fechaCorte, r.proximoVencimiento!),
    }))
    .sort((a, b) => a.fecha.localeCompare(b.fecha) || a.cliente.localeCompare(b.cliente));

  const top = [...porCliente.entries()]
    .map(([clientId, c]) => ({ clientId, ...c, adeudo: r2(c.adeudo), vencido: r2(c.vencido) }))
    .sort((a, b) => b.adeudo - a.adeudo)
    .slice(0, topN);

  return {
    creditos: rows.length,
    clientes: porCliente.size,
    colocado: r2(rows.reduce((s, r) => s + (r.montoCredito ?? 0), 0)),
    adeudo: r2(adeudo),
    vencido: r2(vencido),
    moratorios: r2(rows.reduce((s, r) => s + r.interesesMoratorios, 0)),
    clientesEnMora: enMora.length,
    vencidoEnMora: r2(enMora.reduce((s, c) => s + c.vencido, 0)),
    pctVencido: ratio(vencido, adeudo),
    par30: par(30),
    par60: par(60),
    par90: par(90),
    aging,
    proximos: {
      en7: lista.filter((p) => p.enDias <= 7).length,
      en15: lista.filter((p) => p.enDias <= 15).length,
      en30: lista.length,
      lista,
    },
    top,
  };
}

/** Lo cobrado según ConsultarPagos: en el día de la foto, en los 7 días previos y en el mes. */
export function summarizeCollected(pagos: { fecha: string; monto: number }[], fechaCorte: string) {
  const desde7 = addDays(fechaCorte, -6);
  const inicioMes = `${fechaCorte.slice(0, 7)}-01`;
  const suma = (f: (p: { fecha: string }) => boolean) => {
    const s = pagos.filter((p) => p.fecha <= fechaCorte && f(p));
    return { monto: r2(s.reduce((t, p) => t + p.monto, 0)), pagos: s.length };
  };
  return {
    hoy: suma((p) => p.fecha === fechaCorte),
    semana: suma((p) => p.fecha >= desde7),
    mes: suma((p) => p.fecha >= inicioMes),
  };
}
