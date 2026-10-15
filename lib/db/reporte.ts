// Reporte diario de cobranza a Slack. Se manda una vez al día, después de la
// sincronización y los recordatorios de las 9:00 (o a mano desde Inicio).

import { sql } from "@/lib/db";
import { logAudit } from "@/lib/db/audit";
import { ambienteActual, getCollectionsOverview, getPhotoStatus } from "@/lib/db/collections";
import { getSetting } from "@/lib/collections/store";
import { notifySlack } from "@/lib/collections/notify";
import { fechaMexico } from "@/lib/collections/rules";
import { armarReporte, type DatosReporte } from "@/lib/collections/reporte";
import type { MoraRunResult } from "@/lib/db/whatsapp-mora";

const URL_BACKOFFICE = "https://backoffice.finbra.com";

type ResultadoTanda = MoraRunResult | { error: string } | undefined;

function resumenTanda(origen: string, enviados: Map<string, { enviados: number; fallidos: number }>, tanda: ResultadoTanda) {
  const e = enviados.get(origen) ?? { enviados: 0, fallidos: 0 };
  const bloqueo = !tanda ? null : "error" in tanda ? `No pudo correr: ${tanda.error}` : (tanda.bloqueos[0] ?? null);
  return { ...e, bloqueo };
}

export async function datosReporte(tandas: { mora?: ResultadoTanda; preventivos?: ResultadoTanda } = {}): Promise<DatosReporte> {
  const hoy = fechaMexico();
  const ambiente = ambienteActual();
  const status = await getPhotoStatus();
  const fc = status.fechaCorte;

  const [overview, eventos, promesasHoy, [incumplidas], envios, [chat]] = await Promise.all([
    fc ? getCollectionsOverview(fc) : Promise.resolve(null),
    fc
      ? sql`
          SELECT e.tipo, c.nombre FROM col_credit_events e
          JOIN col_credits cr ON cr.id = e.credit_id JOIN col_clients c ON c.id = cr.client_id
          -- Lo que detectó la foto de hoy (fecha_evento es cuándo pasó, que puede ser antes).
          WHERE c.ambiente = ${ambiente}
            AND e.detectado_en IN (SELECT id FROM col_sync_runs WHERE tipo = 'diaria' AND ambiente = ${ambiente} AND fecha_corte = ${fc})
        `
      : Promise.resolve([]),
    sql`
      SELECT DISTINCT c.nombre FROM col_promises p JOIN col_clients c ON c.id = p.client_id
      WHERE c.ambiente = ${ambiente} AND p.estado = 'vigente' AND p.fecha_compromiso = ${hoy}
      ORDER BY c.nombre
    `,
    sql`
      SELECT count(*)::int AS n FROM col_promises p JOIN col_clients c ON c.id = p.client_id
      WHERE c.ambiente = ${ambiente} AND p.estado = 'incumplida'
        AND (p.resuelta_at AT TIME ZONE 'America/Mexico_City')::date = ${hoy}::date
    `,
    sql`
      SELECT origen, count(*) FILTER (WHERE estado <> 'fallido')::int AS enviados, count(*) FILTER (WHERE estado = 'fallido')::int AS fallidos
      FROM col_wa_messages
      WHERE origen IN ('recordatorio_mora', 'recordatorio_preventivo') AND (created_at AT TIME ZONE 'America/Mexico_City')::date = ${hoy}::date
      GROUP BY origen
    `,
    sql`
      SELECT count(*)::int AS sin_leer, count(DISTINCT telefono)::int AS conversaciones,
             floor(extract(epoch FROM now() - min(created_at)) / 3600)::int AS horas
      FROM col_wa_messages WHERE direccion = 'entrante' AND leido_equipo_at IS NULL
    `,
  ]);

  const porTipo = (t: string) => eventos.filter((e) => e.tipo === t);
  const porOrigen = new Map(envios.map((e) => [e.origen as string, { enviados: e.enviados as number, fallidos: e.fallidos as number }]));
  const ultima = status.ultimaCorrida;
  return {
    fecha: hoy,
    urlBase: URL_BACKOFFICE,
    foto: {
      fechaCorte: fc,
      estado: !fc ? "sin_foto" : fc === hoy ? "al_dia" : "atrasada",
      error: ultima && ultima.status === "error" ? ultima.error : null,
    },
    cartera: overview
      ? { clientesEnMora: overview.resumen.clientesEnMora, vencidoEnMora: overview.resumen.vencidoEnMora, creditos: overview.resumen.creditos, par30: overview.resumen.par30 }
      : null,
    eventos: {
      entradasMora: [...new Set(porTipo("entrada_mora").map((e) => e.nombre as string))].sort(),
      regularizaciones: porTipo("regularizacion").length,
      pagosDetectados: porTipo("pago_detectado").length,
      nuevasVencidas: porTipo("nueva_mensualidad_vencida").length,
    },
    promesas: { vencenHoy: promesasHoy.map((p) => p.nombre as string), incumplidas: incumplidas.n },
    whatsapp: {
      mora: resumenTanda("recordatorio_mora", porOrigen, tandas.mora),
      preventivos: resumenTanda("recordatorio_preventivo", porOrigen, tandas.preventivos),
    },
    chat: { sinLeer: chat.sin_leer, conversaciones: chat.conversaciones, horasMasAntiguo: chat.sin_leer ? chat.horas : null },
    alertas: { abiertas: overview?.alertasAbiertas ?? 0, criticas: overview?.alertasCriticas ?? 0 },
  };
}

/**
 * Manda el reporte a Slack. Sin `forzar`, una sola vez al día: si el cron
 * corre de nuevo, no lo repite. Regresa false si ya se había mandado hoy.
 */
export async function enviarReporteDiario(p: { tandas?: { mora?: ResultadoTanda; preventivos?: ResultadoTanda }; forzar?: boolean; actor: string }): Promise<boolean> {
  const hoy = fechaMexico();
  const ultimo = await getSetting<{ fecha?: string }>("reporte_diario", {});
  if (!p.forzar && ultimo.fecha === hoy) return false;
  const texto = armarReporte(await datosReporte(p.tandas));
  await notifySlack(texto);
  await sql`
    INSERT INTO col_settings (key, value, descripcion, updated_by, updated_at)
    VALUES ('reporte_diario', ${JSON.stringify({ fecha: hoy })}::text::jsonb, 'Último día en que se mandó el reporte diario a Slack.', ${p.actor}, now())
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()
  `;
  if (p.actor !== "cron") await logAudit({ actorEmail: p.actor, action: "cobranza_reporte_slack", entityType: "col_settings", entityId: "reporte_diario" });
  return true;
}
