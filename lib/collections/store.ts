// Escrituras de cobranza compartidas: eventos, alertas y sus entradas en el
// timeline, configuración y el registro de llamadas a SIAC.

import type { TransactionSql } from "postgres";
import { sql } from "@/lib/db";
import type { AlertDraft, DerivedEvent } from "./rules";

export type Tx = TransactionSql;

export const peso = (n: number) => n.toLocaleString("es-MX", { style: "currency", currency: "MXN" });
const dias = (n: number | undefined) => (n === 1 ? "1 día" : `${n ?? 0} días`);

/** Lee un valor de col_settings, o `porDefecto` si no existe o no se puede leer como el tipo esperado. */
export async function getSetting<T>(key: string, porDefecto: T): Promise<T> {
  const [row] = await sql`SELECT value FROM col_settings WHERE key = ${key}`;
  if (!row || row.value === null || row.value === undefined) return porDefecto;
  return typeof porDefecto === "number" ? (Number(row.value) as T) : (row.value as T);
}

/** Registra cada llamada a SIAC en col_siac_raw. El cliente nunca incluye credenciales en `parametros`. */
export function siacCallRecorder(runId: number) {
  return async (r: { operacion: string; parametros: Record<string, string>; httpStatus: number | null; detalle: string | null; respuesta: unknown }) => {
    await sql`
      INSERT INTO col_siac_raw (sync_run_id, operacion, parametros, http_status, detalle, respuesta)
      VALUES (${runId}, ${r.operacion}, ${JSON.stringify(r.parametros)}::jsonb, ${r.httpStatus}, ${r.detalle},
              ${JSON.stringify(r.respuesta ?? null)}::jsonb)
    `;
  };
}

// ---------------------------------------------------------------- eventos

export type EventTipo = DerivedEvent["tipo"] | "salida_listado";

const DESCRIPCION: Record<EventTipo, (noCredito: string, e: Partial<DerivedEvent>) => string> = {
  pago_detectado: (n) => `SIAC registró un pago en el crédito ${n}`,
  entrada_mora: (n, e) => `El crédito ${n} entró en atraso (${peso(e.vencidoDespues ?? 0)} vencidos)`,
  regularizacion: (n, e) => `El crédito ${n} quedó al corriente (tenía ${dias(e.antiguedadAntes)} de atraso)`,
  nueva_mensualidad_vencida: (n, e) => `Venció otra mensualidad del crédito ${n} sin pagarse (${dias(e.antiguedadDespues)} de atraso)`,
  salida_listado: (n) => `El crédito ${n} ya no aparece en el listado de cobranza de SIAC`,
};

/** Inserta el evento y su entrada en el timeline. Regresa 1 si era nuevo. */
export async function insertEvent(
  tx: Tx,
  p: { runId: number; creditId: string; clientId: string; noCredito: string; tipo: EventTipo; event: Partial<DerivedEvent> & { fechaEvento: string } },
): Promise<number> {
  const e = p.event;
  const [row] = await tx`
    INSERT INTO col_credit_events (credit_id, tipo, fecha_evento, antiguedad_antes, antiguedad_despues, vencido_antes, vencido_despues, detectado_en)
    VALUES (${p.creditId}, ${p.tipo}, ${e.fechaEvento}, ${e.antiguedadAntes ?? null}, ${e.antiguedadDespues ?? null},
            ${e.vencidoAntes ?? null}, ${e.vencidoDespues ?? null}, ${p.runId})
    ON CONFLICT (credit_id, tipo, fecha_evento) DO NOTHING
    RETURNING id
  `;
  if (!row) return 0;
  await tx`
    INSERT INTO col_activities (client_id, credit_id, tipo, descripcion, event_id, actor, ocurrido_at)
    VALUES (${p.clientId}, ${p.creditId}, ${p.tipo}, ${DESCRIPCION[p.tipo](p.noCredito, e)}, ${row.id}, 'sistema',
            (${e.fechaEvento}::date + time '12:00') AT TIME ZONE 'America/Mexico_City')
  `;
  return 1;
}

// ---------------------------------------------------------------- alertas

const TITULO_ALERTA: Record<AlertDraft["tipo"], string> = {
  entrada_mora: "Entró a mora",
  nueva_mensualidad_vencida: "Venció otra mensualidad sin pago",
  cambio_bucket: "Subió de rango de atraso",
  promesa_incumplida: "Promesa de pago incumplida",
  mensaje_fallido: "No se pudo entregar un WhatsApp",
  telefono_invalido: "En mora y sin teléfono válido para WhatsApp",
  sync_fallido: "Falló la sincronización con SIAC",
  foto_vieja: "SIAC no actualizó la foto del día",
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

/** Cierra alertas abiertas que dejaron de aplicar (por ejemplo, sync fallida tras una corrida buena). */
export async function closeAlerts(tx: Tx, dedupeKeys: string[]) {
  if (dedupeKeys.length === 0) return;
  await tx`
    UPDATE col_alerts SET estado = 'atendida', atendida_por = 'sistema', atendida_at = now()
    WHERE estado = 'abierta' AND dedupe_key IN ${tx(dedupeKeys)}
  `;
}
