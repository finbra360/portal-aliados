// "Pendientes de hoy" del Inicio general del backoffice: lo que alguien tiene
// que atender hoy, por área y según el rol. Solo conteos, cada uno con su link.

import { sql } from "@/lib/db";
import { ambienteActual, getPhotoStatus } from "@/lib/db/collections";
import { fechaMexico } from "@/lib/collections/rules";
import { COBRANZA_ROLES } from "@/lib/rbac";
import type { AdminRole } from "@/lib/db/admin-users";

export type Tono = "normal" | "atencion" | "urgente";

export interface Pendiente {
  cantidad: number;
  texto: string;
  href: string;
  tono: Tono;
  /** En lugar del número (p. ej. "!" para un aviso). */
  etiqueta?: string;
}

export interface AreaPendientes {
  area: string;
  href: string;
  pendientes: Pendiente[];
}

const COMERCIAL_ROLES: AdminRole[] = ["super_admin", "comercial"];

async function pendientesCobranza(): Promise<AreaPendientes> {
  const ambiente = ambienteActual();
  const hoy = fechaMexico();
  const [status, [chat], [promesas], [alertas]] = await Promise.all([
    getPhotoStatus(),
    sql`SELECT count(*)::int AS mensajes, count(DISTINCT telefono)::int AS conversaciones FROM col_wa_messages WHERE direccion = 'entrante' AND leido_equipo_at IS NULL`,
    sql`
      SELECT count(*) FILTER (WHERE p.fecha_compromiso = ${hoy})::int AS hoy,
             count(*) FILTER (WHERE p.fecha_compromiso < ${hoy})::int AS vencidas
      FROM col_promises p JOIN col_clients c ON c.id = p.client_id
      WHERE c.ambiente = ${ambiente} AND p.estado = 'vigente'
    `,
    sql`
      SELECT count(*) FILTER (WHERE a.severidad = 'critica')::int AS criticas,
             count(*) FILTER (WHERE a.tipo IN ('promesa_incumplida', 'mensaje_fallido'))::int AS por_atender
      FROM col_alerts a LEFT JOIN col_clients c ON c.id = a.client_id
      WHERE a.estado = 'abierta' AND (c.ambiente = ${ambiente} OR a.client_id IS NULL)
    `,
  ]);

  const p: Pendiente[] = [];
  if (status.fechaCorte !== hoy) {
    p.push({ cantidad: 1, texto: status.fechaCorte ? `La foto de SIAC no es de hoy (última: ${status.fechaCorte})` : "Todavía no hay foto de SIAC", href: "/backoffice/cobranza", tono: "urgente", etiqueta: "!" });
  }
  if (chat.mensajes) {
    p.push({ cantidad: chat.mensajes, texto: `${chat.mensajes === 1 ? "mensaje sin leer" : "mensajes sin leer"} en el chat${chat.conversaciones > 1 ? ` (${chat.conversaciones} conversaciones)` : ""}`, href: "/backoffice/cobranza/chat", tono: "atencion" });
  }
  if (promesas.hoy) p.push({ cantidad: promesas.hoy, texto: promesas.hoy === 1 ? "promesa de pago vence hoy" : "promesas de pago vencen hoy", href: "/backoffice/cobranza/cola", tono: "normal" });
  if (alertas.criticas) p.push({ cantidad: alertas.criticas, texto: alertas.criticas === 1 ? "alerta crítica" : "alertas críticas", href: "/backoffice/cobranza", tono: "urgente" });
  if (alertas.por_atender) {
    p.push({ cantidad: alertas.por_atender, texto: alertas.por_atender === 1 ? "promesa incumplida o WhatsApp sin entregar" : "promesas incumplidas o WhatsApp sin entregar", href: "/backoffice/cobranza/cola", tono: "atencion" });
  }
  return { area: "Cobranza", href: "/backoffice/cobranza", pendientes: p };
}

async function pendientesComercial(): Promise<AreaPendientes[]> {
  const [[ops], [leads]] = await Promise.all([
    sql`
      SELECT count(*) FILTER (WHERE etapa = 'recibida')::int AS recibidas,
             count(*) FILTER (WHERE etapa = 'documentacion_pendiente')::int AS documentacion,
             count(*) FILTER (WHERE etapa = 'en_analisis')::int AS analisis
      FROM operations
    `,
    sql`
      SELECT (SELECT count(*)::int FROM lead_companies WHERE categoria = 'hot' AND estatus_comercial = 'nuevo') AS hot_nuevos,
             (SELECT count(*)::int FROM lead_hitl_review WHERE status = 'pendiente') AS revisiones
    `,
  ]);
  const brokers: Pendiente[] = [];
  if (ops.recibidas) brokers.push({ cantidad: ops.recibidas, texto: ops.recibidas === 1 ? "operación nueva por revisar" : "operaciones nuevas por revisar", href: "/backoffice/operaciones", tono: "atencion" });
  if (ops.documentacion) brokers.push({ cantidad: ops.documentacion, texto: ops.documentacion === 1 ? "operación esperando documentación" : "operaciones esperando documentación", href: "/backoffice/operaciones", tono: "normal" });
  if (ops.analisis) brokers.push({ cantidad: ops.analisis, texto: ops.analisis === 1 ? "operación en análisis" : "operaciones en análisis", href: "/backoffice/operaciones", tono: "normal" });

  const lead: Pendiente[] = [];
  if (leads.hot_nuevos) lead.push({ cantidad: leads.hot_nuevos, texto: leads.hot_nuevos === 1 ? "lead hot sin contactar" : "leads hot sin contactar", href: "/backoffice/leads?categoria=hot", tono: "atencion" });
  if (leads.revisiones) lead.push({ cantidad: leads.revisiones, texto: leads.revisiones === 1 ? "lead por revisar a mano" : "leads por revisar a mano", href: "/backoffice/leads", tono: "normal" });

  return [
    { area: "Brokers", href: "/backoffice/brokers/resumen", pendientes: brokers },
    { area: "Leads", href: "/backoffice/leads", pendientes: lead },
  ];
}

/** Áreas que le tocan al rol, cada una con sus pendientes (puede venir vacía: "todo al día"). */
export async function pendientesDeHoy(role: AdminRole): Promise<AreaPendientes[]> {
  const [comercial, cobranza] = await Promise.all([
    COMERCIAL_ROLES.includes(role) ? pendientesComercial() : Promise.resolve([]),
    COBRANZA_ROLES.includes(role) ? pendientesCobranza() : Promise.resolve(null),
  ]);
  return [...comercial, ...(cobranza ? [cobranza] : [])];
}
