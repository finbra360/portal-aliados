// Lecturas del módulo de cobranza para las pantallas del backoffice. Todo sale
// de las tablas col_* que llena la sincronización; nunca de SIAC en vivo.

import { cache } from "react";
import { sql } from "@/lib/db";
import { getSetting, tieneDestinatarioValido } from "@/lib/collections/store";
import { UMBRAL_MORA_DEFAULT, fechaMexico } from "@/lib/collections/rules";
import { summarizeCollected, summarizePortfolio, type PhotoRow } from "@/lib/collections/portfolio";
import { buildQueue, type QueueClient } from "@/lib/collections/queue";
import { buildClientList, type ClientFilter } from "@/lib/collections/clients-list";

export type Ambiente = "pruebas" | "produccion";

/** Ambiente que muestran las pantallas: el mismo que sincroniza el cron. */
export function ambienteActual(): Ambiente {
  return process.env.SIAC_AMBIENTE === "produccion" ? "produccion" : "pruebas";
}

export interface PhotoStatus {
  ambiente: Ambiente;
  /** Fecha de corte de la última foto completa, o null si todavía no hay ninguna. */
  fechaCorte: string | null;
  tomadaAt: string | null;
  /** La corrida más reciente, aunque haya fallado. */
  ultimaCorrida: { status: string; fechaCorte: string | null; at: string; error: string | null } | null;
  /** Días entre la última foto completa y hoy (hora CDMX). */
  diasDeAtraso: number | null;
}

/** Envuelta en cache(): el layout y la página la piden en la misma solicitud. */
export const getPhotoStatus = cache(async (): Promise<PhotoStatus> => {
  const ambiente = ambienteActual();
  const [buena] = await sql`
    SELECT to_char(fecha_corte, 'YYYY-MM-DD') AS fecha_corte, finished_at
    FROM col_sync_runs
    WHERE ambiente = ${ambiente} AND tipo = 'diaria' AND status = 'completado'
    ORDER BY fecha_corte DESC, finished_at DESC LIMIT 1
  `;
  const [ultima] = await sql`
    SELECT status, to_char(fecha_corte, 'YYYY-MM-DD') AS fecha_corte, coalesce(finished_at, started_at) AS at, error_detalle
    FROM col_sync_runs
    WHERE ambiente = ${ambiente} AND tipo = 'diaria'
    ORDER BY id DESC LIMIT 1
  `;
  const fechaCorte: string | null = buena?.fecha_corte ?? null;
  const hoy = fechaMexico();
  return {
    ambiente,
    fechaCorte,
    tomadaAt: buena ? (buena.finished_at as Date).toISOString() : null,
    ultimaCorrida: ultima
      ? { status: ultima.status, fechaCorte: ultima.fecha_corte, at: (ultima.at as Date).toISOString(), error: ultima.error_detalle }
      : null,
    diasDeAtraso: fechaCorte ? Math.round((Date.parse(hoy) - Date.parse(fechaCorte)) / 86_400_000) : null,
  };
});

async function photoRows(ambiente: Ambiente, fechaCorte: string): Promise<PhotoRow[]> {
  const rows = await sql`
    SELECT cr.id AS credit_id, cr.client_id, c.nombre, cr.no_credito, cr.monto_credito,
           s.antiguedad, s.total_vencido, s.intereses_moratorios, s.total_adeudo, s.total_global,
           to_char(s.proximo_vencimiento, 'YYYY-MM-DD') AS proximo_vencimiento
    FROM col_credit_snapshots s
    JOIN col_credits cr ON cr.id = s.credit_id
    JOIN col_clients c ON c.id = cr.client_id
    WHERE cr.ambiente = ${ambiente} AND s.fecha_corte = ${fechaCorte}
  `;
  return rows.map((r) => ({
    creditId: r.credit_id,
    clientId: r.client_id,
    cliente: r.nombre,
    noCredito: r.no_credito,
    montoCredito: r.monto_credito === null ? null : Number(r.monto_credito),
    antiguedad: Number(r.antiguedad),
    totalVencido: Number(r.total_vencido),
    interesesMoratorios: Number(r.intereses_moratorios),
    totalAdeudo: Number(r.total_adeudo),
    totalGlobal: Number(r.total_global),
    proximoVencimiento: r.proximo_vencimiento,
  }));
}

/** Todo lo que necesita la pantalla de inicio de cobranza, para la última foto completa. */
export async function getCollectionsOverview(fechaCorte: string) {
  const ambiente = ambienteActual();
  const umbral = await getSetting("umbral_mora", UMBRAL_MORA_DEFAULT);
  const inicioMes = `${fechaCorte.slice(0, 7)}-01`;

  const [rows, pagos, [sinMonto], [alertas]] = await Promise.all([
    photoRows(ambiente, fechaCorte),
    sql`
      SELECT to_char(p.fecha_aplicacion, 'YYYY-MM-DD') AS fecha, p.monto
      FROM col_payments p JOIN col_credits cr ON cr.id = p.credit_id
      WHERE cr.ambiente = ${ambiente} AND p.fecha_aplicacion >= LEAST(${inicioMes}::date, ${fechaCorte}::date - 6)
    `,
    // Pagos que el listado detectó y cuyo monto no se ha podido traer de ConsultarPagos.
    sql`
      SELECT count(*)::int AS n FROM col_credit_events e JOIN col_credits cr ON cr.id = e.credit_id
      WHERE cr.ambiente = ${ambiente} AND e.tipo = 'pago_detectado' AND e.fecha_evento >= ${inicioMes}
        AND (cr.pagos_sincronizados_at IS NULL OR cr.pagos_sincronizados_at < e.created_at)
    `,
    sql`
      SELECT count(*)::int AS abiertas, count(*) FILTER (WHERE a.severidad = 'critica')::int AS criticas
      FROM col_alerts a LEFT JOIN col_clients c ON c.id = a.client_id
      WHERE a.estado = 'abierta' AND (c.ambiente = ${ambiente} OR a.client_id IS NULL)
    `,
  ]);

  return {
    umbral,
    resumen: summarizePortfolio(rows, umbral, fechaCorte),
    cobrado: summarizeCollected(
      pagos.map((p) => ({ fecha: p.fecha, monto: Number(p.monto) })),
      fechaCorte,
    ),
    pagosSinMonto: sinMonto.n as number,
    alertasAbiertas: alertas.abiertas as number,
    alertasCriticas: alertas.criticas as number,
  };
}

/** Cola de trabajo para la última foto completa. */
export async function getWorkQueue(fechaCorte: string) {
  const ambiente = ambienteActual();
  const umbral = await getSetting("umbral_mora", UMBRAL_MORA_DEFAULT);
  const rows = await sql`
    SELECT c.id, c.nombre, c.numero_cliente, to_char(c.pausa_hasta, 'YYYY-MM-DD') AS pausa_hasta,
           json_agg(json_build_object('noCredito', cr.no_credito, 'antiguedad', s.antiguedad, 'totalVencido', s.total_vencido)
                    ORDER BY s.total_vencido DESC) AS creditos,
           sum(s.total_vencido) AS total_vencido,
           max(s.antiguedad) AS max_antiguedad,
           -- Si algún crédito del cliente está en jurídico o pausado, manda sobre el cliente.
           (array_agg(cr.etapa_manual ORDER BY cr.etapa_manual = 'juridico' DESC) FILTER (WHERE cr.etapa_manual IS NOT NULL))[1] AS etapa_manual,
           (SELECT coalesce(array_agg(DISTINCT a.tipo), '{}') FROM col_alerts a WHERE a.client_id = c.id AND a.estado = 'abierta') AS alertas,
           (SELECT json_build_object('fechaCompromiso', to_char(p.fecha_compromiso, 'YYYY-MM-DD'), 'monto', p.monto)
              FROM col_promises p WHERE p.client_id = c.id AND p.estado = 'vigente'
             ORDER BY p.fecha_compromiso LIMIT 1) AS promesa,
           (SELECT to_char(max(t.ocurrido_at AT TIME ZONE 'America/Mexico_City'), 'YYYY-MM-DD')
              FROM col_activities t
             WHERE t.client_id = c.id AND t.actor <> 'sistema'
               AND t.tipo IN ('llamada', 'nota', 'visita', 'correo', 'whatsapp_enviado', 'promesa_creada')) AS ultima_gestion,
           ${tieneDestinatarioValido()} AS telefono_valido
    FROM col_clients c
    JOIN col_credits cr ON cr.client_id = c.id
    JOIN col_credit_snapshots s ON s.credit_id = cr.id AND s.fecha_corte = ${fechaCorte}
    WHERE c.ambiente = ${ambiente}
    GROUP BY c.id
    HAVING sum(s.total_vencido) > 0
  `;
  const clientes: QueueClient[] = rows.map((r) => ({
    clientId: r.id,
    cliente: r.nombre,
    numeroCliente: r.numero_cliente,
    creditos: (r.creditos as { noCredito: string; antiguedad: number; totalVencido: number | string }[]).map((x) => ({
      noCredito: x.noCredito,
      antiguedad: Number(x.antiguedad),
      totalVencido: Number(x.totalVencido),
    })),
    totalVencido: Number(r.total_vencido),
    maxAntiguedad: Number(r.max_antiguedad),
    alertas: r.alertas as string[],
    promesaVigente: r.promesa ? { fechaCompromiso: r.promesa.fechaCompromiso, monto: Number(r.promesa.monto) } : null,
    ultimaGestion: r.ultima_gestion,
    telefonoValido: r.telefono_valido,
    pausaHasta: r.pausa_hasta,
    etapaManual: r.etapa_manual,
  }));
  return { umbral, items: buildQueue(clientes, umbral, fechaMexico()) };
}

/**
 * Todos los clientes del ambiente, con los totales de su última foto completa
 * (o en cero si todavía no hay foto) y sus contactos, para la lista de clientes.
 */
export async function getClientsList(fechaCorte: string | null, opts: { filtro: ClientFilter; q: string }) {
  const ambiente = ambienteActual();
  const umbral = await getSetting("umbral_mora", UMBRAL_MORA_DEFAULT);
  const [rows, contactos] = await Promise.all([
    sql`
      SELECT c.id, c.nombre, c.numero_cliente, to_char(c.pausa_hasta, 'YYYY-MM-DD') AS pausa_hasta, c.contacto_cobranza_id,
             count(cr.id) FILTER (WHERE cr.en_listado)::int AS creditos_activos,
             coalesce(sum(s.total_adeudo) FILTER (WHERE cr.en_listado), 0) AS adeudo,
             coalesce(sum(s.total_vencido) FILTER (WHERE cr.en_listado), 0) AS vencido,
             coalesce(max(s.antiguedad) FILTER (WHERE cr.en_listado), 0) AS max_atraso,
             to_char(max(s.fecha_ultimo_pago), 'YYYY-MM-DD') AS ultimo_pago,
             coalesce(bool_or(cr.etapa_manual = 'juridico'), false) AS juridico
      FROM col_clients c
      LEFT JOIN col_credits cr ON cr.client_id = c.id
      LEFT JOIN col_credit_snapshots s ON s.credit_id = cr.id AND s.fecha_corte = ${fechaCorte}::date
      WHERE c.ambiente = ${ambiente}
      GROUP BY c.id
    `,
    sql`
      SELECT k.id, k.client_id, k.relacion, k.rol, k.tipo, k.telefono_whatsapp, k.estatus, k.baja_whatsapp_at,
             k.es_principal, k.valor_original, k.nombre_contacto
      FROM col_contacts k JOIN col_clients c ON c.id = k.client_id
      WHERE c.ambiente = ${ambiente}
    `,
  ]);
  const lista = buildClientList(
    rows.map((r) => ({
      clientId: r.id,
      nombre: r.nombre,
      numeroCliente: r.numero_cliente,
      creditosActivos: r.creditos_activos,
      adeudo: Number(r.adeudo),
      vencido: Number(r.vencido),
      maxAtraso: Number(r.max_atraso),
      ultimoPago: r.ultimo_pago,
      pausaHasta: r.pausa_hasta,
      juridico: r.juridico,
      contactoCobranzaId: r.contacto_cobranza_id,
    })),
    contactos.map((k) => ({
      id: k.id,
      clientId: k.client_id,
      relacion: k.relacion,
      rol: k.rol,
      tipo: k.tipo,
      telefonoWhatsapp: k.telefono_whatsapp,
      estatus: k.estatus,
      bajaWhatsappAt: k.baja_whatsapp_at ? String(k.baja_whatsapp_at) : null,
      esPrincipal: k.es_principal,
      valor: k.valor_original,
      nombre: k.nombre_contacto,
    })),
    umbral,
    opts,
  );
  return { umbral, ...lista };
}
