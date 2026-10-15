// Colocación de los brokers: los cálculos que antes hacía n8n con el Sheet
// "Historial Colocacion" (totales, por mes, ranking) y la lectura de la carga
// masiva. Funciones puras, sin base de datos, para probarlas con `node --test`.

import type { BrokerStats, LeaderboardEntry, OperacionFondeada } from "../n8n.ts";
import { leerTabla, normalizarId } from "./importar.ts";

export interface Colocacion {
  id: number;
  brokerId: string;
  /** YYYY-MM-DD */
  fecha: string;
  monto: number;
  comisionAperturaPct: number | null;
  pagadoTotalidad: boolean;
  referencia: string | null;
}

const MESES = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];

/** Lo mismo que calculaba el nodo "Code Agregar Stats" de n8n. */
export function calcularStats(colocaciones: Colocacion[]): BrokerStats {
  const porMes = new Map<string, { anio: number; mesNum: number; monto: number }>();
  let total = 0;
  for (const c of colocaciones) {
    total += c.monto;
    const [anio, mesNum] = c.fecha.split("-").map(Number);
    const clave = `${anio}-${mesNum}`;
    const m = porMes.get(clave) ?? { anio, mesNum, monto: 0 };
    m.monto += c.monto;
    porMes.set(clave, m);
  }
  const operaciones: OperacionFondeada[] = [...colocaciones]
    .sort((a, b) => b.fecha.localeCompare(a.fecha) || b.id - a.id)
    .map((c) => ({
      fecha: c.fecha,
      monto: c.monto,
      comisionAperturaPct: c.comisionAperturaPct ?? undefined,
      pagadoTotalidad: c.pagadoTotalidad,
    }));
  return {
    totalHistorico: total,
    creditosCount: colocaciones.length,
    porMes: [...porMes.values()]
      .sort((a, b) => a.anio - b.anio || a.mesNum - b.mesNum)
      .map((m) => ({ mes: MESES[m.mesNum - 1], anio: m.anio, monto: m.monto })),
    operaciones,
  };
}

/** Lo mismo que el nodo "Code Armar Leaderboard": solo brokers con colocación, por monto. */
export function armarRanking(colocaciones: Colocacion[], nombres: Map<string, string>): LeaderboardEntry[] {
  const totales = new Map<string, { total: number; n: number }>();
  for (const c of colocaciones) {
    const t = totales.get(c.brokerId) ?? { total: 0, n: 0 };
    t.total += c.monto;
    t.n += 1;
    totales.set(c.brokerId, t);
  }
  return [...totales]
    .map(([brokerId, t]) => ({
      brokerId,
      nombre: nombres.get(brokerId) ?? brokerId,
      totalColocado: t.total,
      numOperaciones: t.n,
      ticketPromedio: t.n > 0 ? Math.round(t.total / t.n) : 0,
    }))
    .sort((a, b) => b.totalColocado - a.totalColocado);
}

// ---- Captura y carga masiva ----

/** "2026-06-15", "15/06/2026" o "15-06-2026" (día primero, como en México) → "2026-06-15". */
export function normalizarFecha(texto: string): string | null {
  const t = texto.trim();
  let a: number, m: number, d: number;
  let r = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t);
  if (r) [a, m, d] = [Number(r[1]), Number(r[2]), Number(r[3])];
  else if ((r = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(t))) [d, m, a] = [Number(r[1]), Number(r[2]), Number(r[3])];
  else return null;
  const f = new Date(Date.UTC(a, m - 1, d));
  if (f.getUTCFullYear() !== a || f.getUTCMonth() !== m - 1 || f.getUTCDate() !== d) return null;
  return `${a}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** "$850,000.00", "850000", "850 000" → 850000. null si no es un monto positivo. */
export function normalizarMonto(texto: string): number | null {
  const t = texto.trim().replace(/[$\s]/g, "").replace(/MXN$/i, "").replace(/,/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return null;
  const n = Number(t);
  return n > 0 ? n : null;
}

/** "5", "5%", "4.5 %" → 5 / 4.5. Vacío → null. "error" si no es un % válido. */
export function normalizarPct(texto: string): number | null | "error" {
  const t = texto.trim().replace(/%$/, "").trim();
  if (!t) return null;
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return "error";
  const n = Number(t);
  return n <= 100 ? n : "error";
}

/** "Sí", "si", "TRUE", "1", "x" → true; vacío, "No", "FALSE", "0" → false. */
export function normalizarPagado(texto: string): boolean | "error" {
  const t = texto.trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  if (["si", "true", "1", "x", "pagado"].includes(t)) return true;
  if (["", "no", "false", "0"].includes(t)) return false;
  return "error";
}

export interface ColocacionNueva {
  brokerId: string;
  fecha: string;
  monto: number;
  comisionAperturaPct: number | null;
  pagadoTotalidad: boolean;
  referencia: string | null;
}

export function validarColocacion(
  p: { brokerId: string; fecha: string; monto: string; comisionAperturaPct?: string; pagadoTotalidad?: string; referencia?: string },
  hoy: string,
): ({ ok: true } & ColocacionNueva) | { ok: false; error: string } {
  const brokerId = normalizarId(p.brokerId);
  if (!brokerId || brokerId === "error") return { ok: false, error: "Falta el ID del broker o no es válido" };
  const fecha = normalizarFecha(p.fecha);
  if (!fecha) return { ok: false, error: "La fecha no es válida (usa AAAA-MM-DD o DD/MM/AAAA)" };
  if (fecha > hoy) return { ok: false, error: "La fecha no puede ser futura" };
  const monto = normalizarMonto(p.monto);
  if (monto === null) return { ok: false, error: "El monto no es válido" };
  const pct = normalizarPct(p.comisionAperturaPct ?? "");
  if (pct === "error") return { ok: false, error: "La comisión de apertura debe ser un % entre 0 y 100" };
  const pagado = normalizarPagado(p.pagadoTotalidad ?? "");
  if (pagado === "error") return { ok: false, error: "\"Pagado en su totalidad\" debe ser Sí o No" };
  const referencia = (p.referencia ?? "").trim().replace(/\s+/g, " ") || null;
  if (referencia && referencia.length > 120) return { ok: false, error: "La referencia es demasiado larga" };
  return { ok: true, brokerId, fecha, monto, comisionAperturaPct: pct, pagadoTotalidad: pagado, referencia };
}

const sinAcentos = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
const COLUMNAS: Record<"broker" | "fecha" | "monto" | "pct" | "pagado" | "referencia", string[]> = {
  broker: ["id broker", "id", "broker id", "id_broker", "codigo", "codigo broker", "id lendia", "clave"],
  fecha: ["fecha", "fecha colocacion", "fecha de colocacion", "fecha fondeo", "fecha de fondeo"],
  monto: ["monto mxn", "monto", "monto colocado", "importe"],
  pct: ["comision apertura %", "comision apertura", "comision de apertura", "comision de apertura %", "% comision apertura", "apertura %"],
  pagado: ["pagado en su totalidad", "pagado", "liquidado"],
  referencia: ["referencia", "cliente", "credito", "no. credito", "numero de credito"],
};

export interface FilaColocacion {
  fila: number;
  brokerId: string;
  fecha: string;
  monto: number | null;
  comisionAperturaPct: number | null;
  pagadoTotalidad: boolean;
  referencia: string | null;
  estado: "nuevo" | "existe" | "error";
  detalle: string | null;
}

/** Misma operación: broker, fecha, monto y referencia. */
export const claveColocacion = (c: { brokerId: string; fecha: string; monto: number; referencia: string | null }) =>
  `${c.brokerId}|${c.fecha}|${c.monto.toFixed(2)}|${(c.referencia ?? "").toLowerCase()}`;

/**
 * Valida la carga contra los brokers que existen y la colocación ya guardada.
 * Una fila igual a una ya guardada (misma clave) se marca "existe": así subir
 * dos veces el mismo archivo no duplica. Si de verdad hay dos créditos iguales
 * el mismo día, la columna Referencia los distingue.
 */
export function revisarColocacion(
  texto: string,
  brokers: Set<string>,
  existentes: Iterable<string>,
  hoy: string,
): { filas: FilaColocacion[] } | { error: string } {
  const tabla = leerTabla(texto);
  if (tabla.length < 2) return { error: "El archivo no trae filas de colocación (además de los encabezados)" };
  const h = tabla[0].map(sinAcentos);
  const col = (k: keyof typeof COLUMNAS) => h.findIndex((x) => COLUMNAS[k].includes(x));
  const c = { broker: col("broker"), fecha: col("fecha"), monto: col("monto"), pct: col("pct"), pagado: col("pagado"), referencia: col("referencia") };
  if (c.broker < 0 || c.fecha < 0 || c.monto < 0) {
    return { error: `La primera fila debe traer los encabezados. Se necesitan al menos "ID Broker", "Fecha" y "Monto MXN"; llegó: ${tabla[0].join(", ") || "(vacío)"}` };
  }
  if (tabla.length - 1 > 5000) return { error: "Máximo 5,000 operaciones por carga" };

  const guardadas = new Map<string, number>();
  for (const k of existentes) guardadas.set(k, (guardadas.get(k) ?? 0) + 1);

  const filas = tabla.slice(1).map((r, i): FilaColocacion => {
    const celda = (n: number) => (n >= 0 ? (r[n] ?? "") : "");
    const crudo = { brokerId: celda(c.broker), fecha: celda(c.fecha), monto: celda(c.monto), comisionAperturaPct: celda(c.pct), pagadoTotalidad: celda(c.pagado), referencia: celda(c.referencia) };
    const v = validarColocacion(crudo, hoy);
    if (!v.ok) {
      return {
        fila: i + 2,
        brokerId: crudo.brokerId.trim(),
        fecha: crudo.fecha.trim(),
        monto: normalizarMonto(crudo.monto),
        comisionAperturaPct: null,
        pagadoTotalidad: false,
        referencia: crudo.referencia.trim() || null,
        estado: "error",
        detalle: v.error,
      };
    }
    const { ok: _ok, ...op } = v;
    const fila = { fila: i + 2, ...op };
    if (!brokers.has(op.brokerId)) return { ...fila, estado: "error", detalle: `El broker ${op.brokerId} no está dado de alta` };
    const k = claveColocacion(op);
    const n = guardadas.get(k) ?? 0;
    if (n > 0) {
      guardadas.set(k, n - 1);
      return { ...fila, estado: "existe", detalle: null };
    }
    return { ...fila, estado: "nuevo", detalle: null };
  });
  return { filas };
}
