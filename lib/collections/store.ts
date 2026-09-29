// Escrituras compartidas por la foto diaria (sync.ts) y la reconstrucción
// histórica (backfill.ts): fotos de saldo, eventos, alertas y sus entradas
// en el timeline.

import type { TransactionSql } from "postgres";
import { sql } from "@/lib/db";
import type { SnapshotValues } from "@/lib/siac/parse";
import type { AlertDraft, DayState, DerivedEvent } from "./rules";

export type Tx = TransactionSql;

export const peso = (n: number) => n.toLocaleString("es-MX", { style: "currency", currency: "MXN" });

export interface ActiveCredit {
  id: string;
  client_id: string;
  id_cliente_siac: string;
  no_control: string;
  fecha_alta: string;
}

/** Lo que las reglas necesitan de una foto completa. */
export function dayValues(fechaCorte: string, v: SnapshotValues): Omit<DayState, "vencidoDesde"> {
  return {
    fechaCorte,
    saldoVencido: v.saldoVencido,
    capitalVencido: v.capitalVencido,
    sumaPagos: v.sumaPagos,
    sumaCondonaciones: v.sumaCondonaciones,
    sumaQuitas: v.sumaQuitas,
    sumaCastigos: v.sumaCastigos,
  };
}

function toDayState(r: Record<string, unknown>): DayState {
  return {
    fechaCorte: r.fecha_corte as string,
    saldoVencido: Number(r.saldo_vencido),
    capitalVencido: Number(r.capital_vencido),
    sumaPagos: Number(r.suma_pagos),
    sumaCondonaciones: Number(r.suma_condonaciones),
    sumaQuitas: Number(r.suma_quitas),
    sumaCastigos: Number(r.suma_castigos),
    vencidoDesde: (r.vencido_desde as string) ?? null,
  };
}

// Función y no constante: un fragmento de postgres.js no debe reusarse entre consultas.
const columnasEstado = () => sql`
  to_char(fecha_corte, 'YYYY-MM-DD') AS fecha_corte, saldo_vencido, capital_vencido, suma_pagos,
  suma_condonaciones, suma_quitas, suma_castigos, to_char(vencido_desde, 'YYYY-MM-DD') AS vencido_desde
`;

/** Última foto de un crédito antes de una fecha. */
export async function loadPrevState(creditId: string, antesDe: string): Promise<DayState | null> {
  const [r] = await sql`
    SELECT ${columnasEstado()} FROM col_balance_snapshots
    WHERE credit_id = ${creditId} AND fecha_corte < ${antesDe}
    ORDER BY fecha_corte DESC LIMIT 1
  `;
  return r ? toDayState(r) : null;
}

/** Fotos que tomó la sincronización diaria (no la reconstrucción), en orden. */
export async function loadDailyStates(creditId: string): Promise<DayState[]> {
  const rows = await sql`
    SELECT ${columnasEstado()} FROM col_balance_snapshots
    WHERE credit_id = ${creditId} AND origen IN ('diaria', 'credito')
    ORDER BY fecha_corte
  `;
  return rows.map(toDayState);
}

export async function upsertSnapshot(
  tx: Tx,
  p: {
    creditId: string;
    fechaCorte: string;
    origen: "diaria" | "reconstruccion" | "credito";
    runId: number;
    values: SnapshotValues;
    vencidoDesde: string | null;
  },
) {
  const v = p.values;
  const row = {
    credit_id: p.creditId,
    fecha_corte: p.fechaCorte,
    origen: p.origen,
    sync_run_id: p.runId,
    saldo_vigente: v.saldoVigente,
    capital_vigente: v.capitalVigente,
    iva_capital_vigente: v.ivaCapitalVigente,
    intereses_vigentes: v.interesesVigentes,
    iva_intereses_vigentes: v.ivaInteresesVigentes,
    comisiones_futuras: v.comisionesFuturas,
    iva_comisiones_futuras: v.ivaComisionesFuturas,
    saldo_vencido: v.saldoVencido,
    capital_vencido: v.capitalVencido,
    iva_capital_vencido: v.ivaCapitalVencido,
    intereses_vencidos: v.interesesVencidos,
    iva_intereses_vencidos: v.ivaInteresesVencidos,
    intereses_moratorios: v.interesesMoratorios,
    iva_intereses_moratorios: v.ivaInteresesMoratorios,
    comisiones_vencidas: v.comisionesVencidas,
    iva_comisiones_vencidas: v.ivaComisionesVencidas,
    saldo_actual: v.saldoActual,
    total_pagar: v.totalPagar,
    saldo_global: v.saldoGlobal,
    cat: v.cat,
    suma_ministraciones: v.sumaMinistraciones,
    suma_pagos: v.sumaPagos,
    suma_comisiones: v.sumaComisiones,
    suma_condonaciones: v.sumaCondonaciones,
    suma_quitas: v.sumaQuitas,
    suma_castigos: v.sumaCastigos,
    vencido_desde: p.vencidoDesde,
    fecha_calculo_siac: v.fechaCalculoSiac,
  };
  const { credit_id: _c, fecha_corte: _f, ...cambios } = row;
  await tx`
    INSERT INTO col_balance_snapshots ${tx(row)}
    ON CONFLICT (credit_id, fecha_corte) DO UPDATE SET ${tx(cambios)}, obtenido_at = now()
  `;
}

const ACTIVIDAD_POR_EVENTO: Record<DerivedEvent["tipo"], string> = {
  pago: "pago_detectado",
  entrada_vencido: "entrada_vencido",
  regularizacion: "regularizacion",
  condonacion: "ajuste_siac",
  quita: "ajuste_siac",
  castigo: "ajuste_siac",
};

function describirEvento(ev: DerivedEvent, noControl: string): string {
  switch (ev.tipo) {
    case "pago":
      return `Pago de ${peso(ev.monto ?? 0)} registrado en SIAC (crédito ${noControl})`;
    case "entrada_vencido":
      return `El crédito ${noControl} entró a vencido con ${peso(ev.vencidoDespues)}`;
    case "regularizacion":
      return `El crédito ${noControl} quedó al corriente (tenía ${peso(ev.vencidoAntes)} vencidos)`;
    default:
      return `${ev.tipo[0].toUpperCase()}${ev.tipo.slice(1)} de ${peso(ev.monto ?? 0)} en SIAC (crédito ${noControl})`;
  }
}

/** Inserta el evento y su entrada en el timeline. Regresa 1 si era nuevo. */
export async function insertEvent(tx: Tx, runId: number, cr: ActiveCredit, ev: DerivedEvent): Promise<number> {
  const [row] = await tx`
    INSERT INTO col_credit_events (credit_id, tipo, fecha_evento, monto, vencido_antes, vencido_despues, detectado_en)
    VALUES (${cr.id}, ${ev.tipo}, ${ev.fechaEvento}, ${ev.monto}, ${ev.vencidoAntes}, ${ev.vencidoDespues}, ${runId})
    ON CONFLICT (credit_id, tipo, fecha_evento) DO NOTHING
    RETURNING id
  `;
  if (!row) return 0;
  await tx`
    INSERT INTO col_activities (client_id, credit_id, tipo, descripcion, event_id, actor, ocurrido_at)
    VALUES (${cr.client_id}, ${cr.id}, ${ACTIVIDAD_POR_EVENTO[ev.tipo]}, ${describirEvento(ev, cr.no_control)},
            ${row.id}, 'sistema', (${ev.fechaEvento}::date + time '12:00') AT TIME ZONE 'America/Mexico_City')
  `;
  return 1;
}

const TITULO_ALERTA: Record<AlertDraft["tipo"], string> = {
  entrada_vencido: "Entró a mora",
  aumento_vencido: "Venció otra mensualidad sin pago",
  cambio_bucket: "Subió de rango de atraso",
  promesa_incumplida: "Promesa de pago incumplida",
  mensaje_fallido: "No se pudo entregar un WhatsApp",
  telefono_invalido: "En mora y sin teléfono válido para WhatsApp",
  sync_fallido: "Falló la sincronización con SIAC",
};

/** Abre la alerta si no hay otra abierta con la misma llave, y la anota en el timeline. Regresa 1 si era nueva. */
export async function openAlert(tx: Tx, clientId: string | null, creditId: string | null, al: AlertDraft): Promise<number> {
  const [row] = await tx`
    INSERT INTO col_alerts (client_id, credit_id, tipo, severidad, dedupe_key, detalle)
    VALUES (${clientId}, ${creditId}, ${al.tipo}, ${al.severidad}, ${al.dedupeKey}, ${JSON.stringify(al.detalle)}::jsonb)
    ON CONFLICT (dedupe_key) WHERE estado = 'abierta' DO NOTHING
    RETURNING id
  `;
  if (!row) return 0;
  if (clientId) {
    await tx`
      INSERT INTO col_activities (client_id, credit_id, tipo, descripcion, alert_id, metadata, actor)
      VALUES (${clientId}, ${creditId}, 'alerta', ${TITULO_ALERTA[al.tipo]}, ${row.id},
              ${JSON.stringify(al.detalle)}::jsonb, 'sistema')
    `;
  }
  return 1;
}

/** Registra cada llamada a SIAC en col_siac_raw (sin credenciales; el cliente nunca las incluye). */
export function siacCallRecorder(runId: number) {
  return async (r: { operacion: string; parametros: Record<string, string>; httpStatus: number | null; detalle: string | null; respuesta: unknown }) => {
    await sql`
      INSERT INTO col_siac_raw (sync_run_id, operacion, parametros, http_status, detalle, respuesta)
      VALUES (${runId}, ${r.operacion}, ${JSON.stringify(r.parametros)}::jsonb, ${r.httpStatus}, ${r.detalle},
              ${JSON.stringify(r.respuesta ?? null)}::jsonb)
    `;
  };
}
