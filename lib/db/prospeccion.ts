import { sql } from "@/lib/db";
import { logAudit } from "./audit";

/**
 * Cola de conversaciones que el agente de WhatsApp dejó para una persona.
 *
 * El agente hace el filtro: pregunta unidades, gravamen y ventas, y solo pasa a
 * humano a quien cumple la banda del ICP o a quien hizo una pregunta que el
 * agente tiene prohibido contestar (tasas, plazos, condiciones — ahí es donde
 * una SOFOM se mete en problemas si improvisa un bot).
 *
 * Lo que vuelve esto una cola y no una lista es el reloj. Una conversación que
 * el prospecto inició abre una ventana de 24 horas en la que se le puede
 * escribir libremente; pasada la ventana hace falta una plantilla aprobada y la
 * conversación en la práctica se muere. Por eso el orden es por vencimiento, no
 * por score: un lead de 65 puntos con 40 minutos de ventana es más urgente que
 * uno de 62 con veinte horas.
 */
export const VENTANA_HORAS = 24;

export interface ConversacionPendiente {
  companyId: string;
  nombreComercial: string;
  telefono: string | null;
  totalScore: number | null;
  estatusComercial: string;
  unidades: number | null;
  libresGravamen: boolean | null;
  ventas: number | null;
  /** Momento del último mensaje del prospecto: de aquí cuelga la ventana. */
  ultimoMensaje: string;
  mensajeRecibido: string | null;
  respuestaEnviada: string | null;
}

function mapConversacion(r: Record<string, unknown>): ConversacionPendiente {
  return {
    companyId: r.id as string,
    nombreComercial: r.nombre_comercial as string,
    telefono: (r.telefono_principal as string) ?? null,
    totalScore: r.total_score == null ? null : Number(r.total_score),
    estatusComercial: r.estatus_comercial as string,
    unidades: r.unidades_flota_estimado == null ? null : Number(r.unidades_flota_estimado),
    libresGravamen: (r.unidades_libres_gravamen as boolean) ?? null,
    ventas: r.ventas_estimado_mxn == null ? null : Number(r.ventas_estimado_mxn),
    ultimoMensaje: (r.ultimo_mensaje as Date).toISOString(),
    mensajeRecibido: (r.mensaje_recibido as string) ?? null,
    respuestaEnviada: (r.respuesta_enviada as string) ?? null,
  };
}

/**
 * Una conversación sale de la cola cuando una persona deja actividad posterior
 * al último mensaje del prospecto: el botón de «Ya la atendí», o un cambio de
 * estatus desde la tabla de leads. En los dos casos alguien ya la tocó.
 *
 * Qué cuenta como persona se define por lo que SÍ es, no por descarte. La
 * tentación es escribir `actor <> 'agente_prospeccion'`, y está mal: el actor
 * del pipeline es 'system' y lleva más de 22,000 filas, así que la corrida
 * diaria vaciaría la cola sola y en silencio. Los actos humanos se reconocen
 * porque el actor es un correo de admin, o es la etiqueta 'revision_humana'
 * que deja la cola HITL.
 */
export async function listConversacionesPendientes(): Promise<ConversacionPendiente[]> {
  const rows = await sql`
    WITH ultima_del_agente AS (
      SELECT DISTINCT ON (company_id) company_id, created_at, metadata
      FROM lead_prospecting_activity
      WHERE actor = 'agente_prospeccion' AND activity_type = 'handoff_a_ventas'
      ORDER BY company_id, created_at DESC
    ),
    ultimo_humano AS (
      SELECT company_id, MAX(created_at) AS created_at
      FROM lead_prospecting_activity
      WHERE actor LIKE '%@%' OR actor = 'revision_humana'
      GROUP BY company_id
    )
    SELECT c.id, c.nombre_comercial, c.telefono_principal, c.total_score,
           c.estatus_comercial, c.unidades_flota_estimado,
           c.unidades_libres_gravamen, c.ventas_estimado_mxn,
           u.created_at AS ultimo_mensaje,
           u.metadata->>'mensaje_recibido' AS mensaje_recibido,
           u.metadata->>'respuesta_enviada' AS respuesta_enviada
    FROM ultima_del_agente u
    JOIN lead_companies c ON c.id = u.company_id
    LEFT JOIN ultimo_humano h ON h.company_id = u.company_id
    WHERE h.created_at IS NULL OR h.created_at < u.created_at
    ORDER BY u.created_at ASC
    LIMIT 200
  `;
  return rows.map(mapConversacion);
}

export interface ResumenProspeccion {
  /** Conversaciones que el agente tuvo hoy, por desenlace. */
  hoyHandoff: number;
  hoyEnCurso: number;
  hoyCerradas: number;
  hoyCorreos: number;
  /** Atendidas hoy por una persona. */
  hoyAtendidas: number;
}

export async function resumenProspeccionHoy(): Promise<ResumenProspeccion> {
  const rows = await sql`
    SELECT activity_type, actor = 'agente_prospeccion' AS del_agente, COUNT(*)::int AS count
    FROM lead_prospecting_activity
    WHERE created_at >= date_trunc('day', now())
    GROUP BY activity_type, actor = 'agente_prospeccion'
  `;
  const base: ResumenProspeccion = {
    hoyHandoff: 0,
    hoyEnCurso: 0,
    hoyCerradas: 0,
    hoyCorreos: 0,
    hoyAtendidas: 0,
  };
  for (const r of rows) {
    const tipo = r.activity_type as string;
    const n = r.count as number;
    if (!r.del_agente) {
      if (tipo === "atendido_por_humano") base.hoyAtendidas += n;
      continue;
    }
    if (tipo === "handoff_a_ventas") base.hoyHandoff += n;
    else if (tipo === "conversacion_en_curso") base.hoyEnCurso += n;
    else if (tipo === "conversacion_cerrada") base.hoyCerradas += n;
    else if (tipo === "correo_enviado") base.hoyCorreos += n;
  }
  return base;
}

/**
 * Marca que una persona ya se hizo cargo. No cambia el estatus comercial a
 * propósito: quien atiende decide después si eso fue una reunión agendada, un
 * rechazo o sigue abierto, y adivinarlo desde aquí sería inventar.
 */
export async function marcarConversacionAtendida(params: {
  companyId: string;
  actorEmail: string;
  nota: string | null;
}): Promise<void> {
  const rows = await sql`
    SELECT id FROM lead_companies WHERE id = ${params.companyId}
  `;
  if (!rows[0]) {
    throw new Error("Lead no encontrado");
  }
  await sql`
    INSERT INTO lead_prospecting_activity (company_id, activity_type, actor, metadata)
    VALUES (
      ${params.companyId},
      'atendido_por_humano',
      ${params.actorEmail},
      jsonb_build_object('nota', ${params.nota}::text)
    )
  `;
  await logAudit({
    actorEmail: params.actorEmail,
    action: "marcar_conversacion_atendida",
    entityType: "lead_company",
    entityId: params.companyId,
    metadata: { nota: params.nota },
  });
}
