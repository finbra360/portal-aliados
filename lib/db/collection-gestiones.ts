// Gestiones de cobranza desde el perfil del cliente. Toda escritura deja una
// entrada en el timeline (col_activities) y en audit_log, en la misma
// transacción que el cambio (salvo audit_log, que se escribe al final).

import { sql } from "@/lib/db";
import { logAudit } from "@/lib/db/audit";
import { ambienteActual } from "@/lib/db/collections";
import { SiacClient, getSiacConfig } from "@/lib/siac/client";
import { fechaMexico } from "@/lib/collections/rules";
import { siacCallRecorder, peso, type Tx } from "@/lib/collections/store";
import {
  CANALES_PROMESA,
  ETAPAS,
  RESULTADOS,
  TIPOS_GESTION,
  puedeConsultarSaldo,
  validarGestion,
  validarPausa,
  validarPromesa,
  type CanalPromesa,
  type Etapa,
} from "@/lib/collections/gestiones";
import { formatFecha } from "@/lib/format";

export class GestionError extends Error {}

async function loadClient(tx: Tx, clientId: string) {
  const [c] = await tx`SELECT * FROM col_clients WHERE id = ${clientId} AND ambiente = ${ambienteActual()} FOR UPDATE`;
  if (!c) throw new GestionError("No encontramos ese cliente");
  return c;
}

async function loadCredit(tx: Tx, creditId: string, clientId?: string) {
  const [cr] = await tx`
    SELECT cr.* FROM col_credits cr JOIN col_clients c ON c.id = cr.client_id
    WHERE cr.id = ${creditId} AND c.ambiente = ${ambienteActual()}
  `;
  if (!cr || (clientId && cr.client_id !== clientId)) throw new GestionError("Ese crédito no es de este cliente");
  return cr;
}

async function activity(
  tx: Tx,
  p: {
    clientId: string;
    creditId?: string | null;
    tipo: string;
    resultado?: string | null;
    descripcion: string;
    actor: string;
    promiseId?: number | null;
    alertId?: number | null;
    metadata?: Record<string, unknown>;
  },
) {
  const [row] = await tx`
    INSERT INTO col_activities (client_id, credit_id, tipo, resultado, descripcion, promise_id, alert_id, metadata, actor)
    VALUES (${p.clientId}, ${p.creditId ?? null}, ${p.tipo}, ${p.resultado ?? null}, ${p.descripcion}, ${p.promiseId ?? null},
            ${p.alertId ?? null}, ${p.metadata ? JSON.stringify(p.metadata) : null}::jsonb, ${p.actor})
    RETURNING id
  `;
  return row.id as string;
}

// ---------------------------------------------------------------- promesas

async function crearPromesaTx(
  tx: Tx,
  p: { clientId: string; creditId: string | null; monto: string; fecha: string; canal: CanalPromesa; notas: string | null; actor: string },
) {
  const v = validarPromesa({ monto: p.monto, fecha: p.fecha, hoy: fechaMexico() });
  if (!v.ok) throw new GestionError(v.error);
  if (!(p.canal in CANALES_PROMESA)) throw new GestionError("Canal no válido");
  if (p.creditId) await loadCredit(tx, p.creditId, p.clientId);

  // Vencido de la última foto: sin montos de pago, la promesa se resuelve contra este valor.
  const [{ vencido }] = await tx`
    SELECT coalesce(sum(s.total_vencido), 0) AS vencido
    FROM col_credits cr
    JOIN LATERAL (SELECT total_vencido FROM col_credit_snapshots WHERE credit_id = cr.id ORDER BY fecha_corte DESC LIMIT 1) s ON true
    WHERE cr.client_id = ${p.clientId} AND cr.en_listado AND (${p.creditId}::uuid IS NULL OR cr.id = ${p.creditId})
  `;

  // Una sola promesa vigente por cliente: la nueva reemplaza a las anteriores.
  const reemplazadas = await tx`
    UPDATE col_promises SET estado = 'cancelada', resuelta_por = 'manual', resuelta_at = now(),
      notas = concat_ws(' · ', notas, 'Reemplazada por una promesa nueva')
    WHERE client_id = ${p.clientId} AND estado = 'vigente'
    RETURNING id, monto, to_char(fecha_compromiso, 'YYYY-MM-DD') AS fecha
  `;
  for (const r of reemplazadas) {
    await activity(tx, {
      clientId: p.clientId,
      tipo: "promesa_resuelta",
      descripcion: `Promesa de ${peso(Number(r.monto))} al ${formatFecha(r.fecha)} cancelada: la reemplaza una nueva`,
      actor: p.actor,
      promiseId: r.id,
    });
  }

  const [row] = await tx`
    INSERT INTO col_promises (client_id, credit_id, monto, fecha_compromiso, vencido_al_crear, canal, notas, created_by)
    VALUES (${p.clientId}, ${p.creditId}, ${v.monto}, ${v.fecha}, ${Number(vencido)}, ${p.canal}, ${p.notas?.trim() || null}, ${p.actor})
    RETURNING id
  `;
  await activity(tx, {
    clientId: p.clientId,
    creditId: p.creditId,
    tipo: "promesa_creada",
    descripcion: `Prometió pagar ${peso(v.monto)} el ${formatFecha(v.fecha)} (${CANALES_PROMESA[p.canal].toLowerCase()})${p.notas?.trim() ? `: ${p.notas.trim()}` : ""}`,
    actor: p.actor,
    promiseId: row.id,
  });
  return row.id as number;
}

export async function crearPromesa(p: Parameters<typeof crearPromesaTx>[1]) {
  let id = 0;
  await sql.begin(async (tx) => {
    await loadClient(tx, p.clientId);
    id = await crearPromesaTx(tx, p);
  });
  await logAudit({ actorEmail: p.actor, action: "cobranza_promesa_alta", entityType: "col_promise", entityId: String(id), metadata: { clientId: p.clientId, monto: p.monto, fecha: p.fecha } });
  return id;
}

/** Cierra a mano una promesa vigente: cumplida (pagó por fuera de lo que ve SIAC) o cancelada. */
export async function resolverPromesa(p: { clientId: string; promiseId: number; estado: "cumplida" | "cancelada"; actor: string }) {
  if (p.estado !== "cumplida" && p.estado !== "cancelada") throw new GestionError("Estado no válido");
  await sql.begin(async (tx) => {
    await loadClient(tx, p.clientId);
    const [pr] = await tx`
      UPDATE col_promises SET estado = ${p.estado}, resuelta_por = 'manual', resuelta_at = now()
      WHERE id = ${p.promiseId} AND client_id = ${p.clientId} AND estado = 'vigente'
      RETURNING monto, to_char(fecha_compromiso, 'YYYY-MM-DD') AS fecha, credit_id
    `;
    if (!pr) throw new GestionError("Esa promesa ya no está vigente");
    await activity(tx, {
      clientId: p.clientId,
      creditId: pr.credit_id,
      tipo: "promesa_resuelta",
      descripcion: `Promesa de ${peso(Number(pr.monto))} al ${formatFecha(pr.fecha)} marcada como ${p.estado} a mano`,
      actor: p.actor,
      promiseId: p.promiseId,
    });
  });
  await logAudit({ actorEmail: p.actor, action: "cobranza_promesa_resuelta", entityType: "col_promise", entityId: String(p.promiseId), metadata: { estado: p.estado, clientId: p.clientId } });
}

// ---------------------------------------------------------------- gestiones

export async function registrarGestion(p: {
  clientId: string;
  tipo: string;
  resultado: string | null;
  descripcion: string;
  contactId: string | null;
  creditId: string | null;
  promesa: { monto: string; fecha: string; canal: CanalPromesa } | null;
  actor: string;
}) {
  const v = validarGestion(p);
  if (!v.ok) throw new GestionError(v.error);
  if (v.resultado === "promesa" && !p.promesa) throw new GestionError("Escribe el monto y la fecha que prometió");

  let promiseId: number | null = null;
  await sql.begin(async (tx) => {
    await loadClient(tx, p.clientId);
    let contacto: string | null = null;
    if (p.contactId) {
      const [k] = await tx`SELECT valor_original, nombre_contacto FROM col_contacts WHERE id = ${p.contactId} AND client_id = ${p.clientId}`;
      if (!k) throw new GestionError("Ese contacto no es de este cliente");
      contacto = k.nombre_contacto ? `${k.nombre_contacto} (${k.valor_original})` : k.valor_original;
    }
    if (p.creditId) await loadCredit(tx, p.creditId, p.clientId);

    const partes = [
      v.resultado ? RESULTADOS[v.resultado] : null,
      contacto ? `con ${contacto}` : null,
    ].filter(Boolean);
    const encabezado = partes.length ? `${TIPOS_GESTION[v.tipo]}: ${partes.join(", ")}` : TIPOS_GESTION[v.tipo];
    await activity(tx, {
      clientId: p.clientId,
      creditId: p.creditId,
      tipo: v.tipo,
      resultado: v.resultado,
      descripcion: v.descripcion ? `${encabezado}. ${v.descripcion}` : encabezado,
      actor: p.actor,
      metadata: p.contactId ? { contactId: p.contactId } : undefined,
    });
    if (v.resultado === "promesa" && p.promesa) {
      promiseId = await crearPromesaTx(tx, {
        clientId: p.clientId,
        creditId: p.creditId,
        monto: p.promesa.monto,
        fecha: p.promesa.fecha,
        canal: p.promesa.canal,
        notas: null,
        actor: p.actor,
      });
    }
  });
  await logAudit({ actorEmail: p.actor, action: "cobranza_gestion", entityType: "col_client", entityId: p.clientId, metadata: { tipo: v.tipo, resultado: v.resultado, promiseId } });
}

// ---------------------------------------------------------------- pausa, alertas y etapa

export async function pausarCobranza(p: { clientId: string; hasta: string; motivo: string; actor: string }) {
  const v = validarPausa({ hasta: p.hasta, motivo: p.motivo, hoy: fechaMexico() });
  if (!v.ok) throw new GestionError(v.error);
  await sql.begin(async (tx) => {
    await loadClient(tx, p.clientId);
    await tx`UPDATE col_clients SET pausa_hasta = ${v.hasta}, pausa_motivo = ${v.motivo} WHERE id = ${p.clientId}`;
    await activity(tx, { clientId: p.clientId, tipo: "pausa", descripcion: `Cobranza pausada hasta el ${formatFecha(v.hasta)}: ${v.motivo}`, actor: p.actor });
  });
  await logAudit({ actorEmail: p.actor, action: "cobranza_pausa", entityType: "col_client", entityId: p.clientId, metadata: { hasta: v.hasta } });
}

export async function reanudarCobranza(p: { clientId: string; actor: string }) {
  await sql.begin(async (tx) => {
    const c = await loadClient(tx, p.clientId);
    if (!c.pausa_hasta) throw new GestionError("La cobranza de este cliente no está pausada");
    await tx`UPDATE col_clients SET pausa_hasta = NULL, pausa_motivo = NULL WHERE id = ${p.clientId}`;
    await activity(tx, { clientId: p.clientId, tipo: "pausa", descripcion: "Se reanudó la cobranza", actor: p.actor });
  });
  await logAudit({ actorEmail: p.actor, action: "cobranza_reanudar", entityType: "col_client", entityId: p.clientId });
}

const TITULO_ALERTA: Record<string, string> = {
  entrada_mora: "Entró a mora",
  nueva_mensualidad_vencida: "Venció otra mensualidad sin pago",
  cambio_bucket: "Subió de rango de atraso",
  promesa_incumplida: "Promesa de pago incumplida",
  mensaje_fallido: "No se pudo entregar un WhatsApp",
  telefono_invalido: "Sin teléfono válido para WhatsApp",
};

export async function atenderAlerta(p: { clientId: string; alertId: number; estado: "atendida" | "descartada"; actor: string }) {
  if (p.estado !== "atendida" && p.estado !== "descartada") throw new GestionError("Estado no válido");
  await sql.begin(async (tx) => {
    await loadClient(tx, p.clientId);
    const [a] = await tx`
      UPDATE col_alerts SET estado = ${p.estado}, atendida_por = ${p.actor}, atendida_at = now()
      WHERE id = ${p.alertId} AND client_id = ${p.clientId} AND estado = 'abierta'
      RETURNING tipo, credit_id
    `;
    if (!a) throw new GestionError("Esa alerta ya no está abierta");
    await activity(tx, {
      clientId: p.clientId,
      creditId: a.credit_id,
      tipo: "alerta",
      descripcion: `Alerta "${TITULO_ALERTA[a.tipo] ?? a.tipo}" marcada como ${p.estado}`,
      actor: p.actor,
      alertId: p.alertId,
    });
  });
  await logAudit({ actorEmail: p.actor, action: "cobranza_alerta", entityType: "col_alert", entityId: String(p.alertId), metadata: { estado: p.estado, clientId: p.clientId } });
}

export async function cambiarEtapa(p: { clientId: string; creditId: string; etapa: Etapa | null; actor: string }) {
  if (p.etapa !== null && !(p.etapa in ETAPAS)) throw new GestionError("Etapa no válida");
  await sql.begin(async (tx) => {
    await loadClient(tx, p.clientId);
    const cr = await loadCredit(tx, p.creditId, p.clientId);
    if ((cr.etapa_manual ?? null) === p.etapa) return;
    await tx`
      UPDATE col_credits SET etapa_manual = ${p.etapa}, etapa_manual_por = ${p.actor}, etapa_manual_at = now()
      WHERE id = ${p.creditId}
    `;
    await activity(tx, {
      clientId: p.clientId,
      creditId: p.creditId,
      tipo: "cambio_etapa",
      descripcion: p.etapa ? `El crédito ${cr.no_credito} pasó a ${ETAPAS[p.etapa]}` : `El crédito ${cr.no_credito} regresó a cobranza normal`,
      actor: p.actor,
      metadata: { antes: cr.etapa_manual, despues: p.etapa },
    });
  });
  await logAudit({ actorEmail: p.actor, action: "cobranza_etapa", entityType: "col_credit", entityId: p.creditId, metadata: { etapa: p.etapa, clientId: p.clientId } });
}

// ---------------------------------------------------------------- saldo al día

export interface SaldoAlDia {
  fechaCorte: string;
  saldoVencido: number;
  totalPagar: number;
  saldoActual: number;
  consultadoAt: string;
}

/**
 * Pide a SIAC el saldo de UN crédito a hoy (ConsultarSaldoCredito). Es la
 * única consulta individual que hace la plataforma: la dispara una persona,
 * con a lo más una por crédito cada MINUTOS_ENTRE_CONSULTAS_SALDO.
 */
export async function consultarSaldoAlDia(p: { clientId: string; creditId: string; actor: string }): Promise<SaldoAlDia> {
  const config = getSiacConfig();
  if (!config) throw new GestionError("La conexión con SIAC no está configurada");

  const [cr] = await sql`
    SELECT cr.id, cr.no_credito, cr.numero_cliente,
           (SELECT max(created_at) FROM col_saldo_consultas WHERE credit_id = cr.id) AS ultima
    FROM col_credits cr JOIN col_clients c ON c.id = cr.client_id
    WHERE cr.id = ${p.creditId} AND cr.client_id = ${p.clientId} AND c.ambiente = ${ambienteActual()}
  `;
  if (!cr) throw new GestionError("Ese crédito no es de este cliente");
  const limite = puedeConsultarSaldo(cr.ultima ? new Date(cr.ultima) : null, new Date());
  if (!limite.ok) throw new GestionError(`Ya se consultó hace poco. Vuelve a intentar en ${limite.minutos} min.`);

  const hoy = fechaMexico();
  const [run] = await sql`
    INSERT INTO col_sync_runs (ambiente, tipo, fecha_corte, disparado_por) VALUES (${config.ambiente}, 'consulta', ${hoy}, ${p.actor}) RETURNING id
  `;
  const siac = new SiacClient(config, siacCallRecorder(run.id));
  let r;
  try {
    r = await siac.consultarSaldoCredito(cr.no_credito, cr.numero_cliente, hoy);
  } catch (e) {
    await sql`UPDATE col_sync_runs SET status = 'error', error_detalle = ${(e as Error).message}, llamadas_siac = ${siac.llamadas}, finished_at = now() WHERE id = ${run.id}`;
    throw new GestionError(`SIAC no respondió el saldo: ${(e as Error).message}`);
  }

  const money = (n: unknown) => Math.round((Number(n) || 0) * 100) / 100;
  const saldo = {
    saldoVigente: money(r.SaldoVigente?.saldoVigente),
    saldoVencido: money(r.SaldoVencido?.saldoVencido),
    totalPagar: money(r.Totales?.TotalPagar),
    saldoActual: money(r.Totales?.SaldoActual),
  };
  let consultadoAt = new Date().toISOString();
  await sql.begin(async (tx) => {
    const [row] = await tx`
      INSERT INTO col_saldo_consultas (credit_id, fecha_corte, saldo_vigente, saldo_vencido, total_pagar, saldo_actual, detalle, pedido_por, sync_run_id)
      VALUES (${p.creditId}, ${hoy}, ${saldo.saldoVigente}, ${saldo.saldoVencido}, ${saldo.totalPagar}, ${saldo.saldoActual},
              ${JSON.stringify(r)}::jsonb, ${p.actor}, ${run.id})
      RETURNING created_at
    `;
    consultadoAt = (row.created_at as Date).toISOString();
    await activity(tx, {
      clientId: p.clientId,
      creditId: p.creditId,
      tipo: "saldo_consultado",
      descripcion: `Saldo al día del crédito ${cr.no_credito}: vencido ${peso(saldo.saldoVencido)}, total a pagar ${peso(saldo.totalPagar)}`,
      actor: p.actor,
    });
    await tx`UPDATE col_sync_runs SET status = 'completado', creditos_leidos = 1, llamadas_siac = ${siac.llamadas}, duracion_siac_ms = ${siac.duracionMs}, finished_at = now() WHERE id = ${run.id}`;
  });
  await logAudit({ actorEmail: p.actor, action: "cobranza_saldo_al_dia", entityType: "col_credit", entityId: p.creditId, metadata: { clientId: p.clientId } });
  return { fechaCorte: hoy, saldoVencido: saldo.saldoVencido, totalPagar: saldo.totalPagar, saldoActual: saldo.saldoActual, consultadoAt };
}
