// Chat de WhatsApp: lo que llega de Meta (webhook), la bandeja y las
// respuestas del equipo. Todo mensaje, de entrada o salida, queda en
// col_wa_messages; los de clientes identificados, también en su historial.

import { sql, transaccion } from "@/lib/db";
import { logAudit } from "@/lib/db/audit";
import { ambienteActual } from "@/lib/db/collections";
import { openAlert } from "@/lib/collections/store";
import { notifySlack } from "@/lib/collections/notify";
import { PLANTILLA_CONTACTO, RANGO_ESTADO, esBaja, leerWebhook, ventana, type MensajeEntrante } from "@/lib/collections/chat";
import { motivoNoActivable, renderPlantilla } from "@/lib/collections/whatsapp-mora";
import { WhatsAppError, descargarMedia, enviarPlantilla, enviarTexto, getWhatsAppConfig } from "@/lib/whatsapp/client";

export class ChatError extends Error {}

const URL_BACKOFFICE = "https://backoffice.finbra.com";
const MAX_TEXTO = 4096;
const CONFIRMACION_BAJA = "Listo, ya no te enviaremos recordatorios por WhatsApp. Si necesitas algo, escríbenos aquí.";

/** El cliente que tiene ese teléfono en sus contactos, si es uno solo. */
async function clienteDeTelefono(telefono: string): Promise<{ clientId: string; contactId: string; nombre: string } | null> {
  const rows = await sql`
    SELECT k.id AS contact_id, c.id AS client_id, c.nombre
    FROM col_contacts k JOIN col_clients c ON c.id = k.client_id
    WHERE k.telefono_whatsapp = ${telefono} AND c.ambiente = ${ambienteActual()}
    ORDER BY (k.relacion = 'titular') DESC, k.es_principal DESC
  `;
  const clientes = new Set(rows.map((r) => r.client_id));
  if (clientes.size !== 1) return null; // nadie, o el mismo número en varios clientes
  return { clientId: rows[0].client_id, contactId: rows[0].contact_id, nombre: rows[0].nombre };
}

async function registrarSaliente(p: {
  telefono: string;
  clientId: string | null;
  contactId: string | null;
  tipo: "texto" | "plantilla";
  cuerpo: string | null;
  templateId?: number | null;
  parametros?: string[] | null;
  wamid: string | null;
  estado: "enviado" | "fallido";
  error?: Record<string, unknown> | null;
  enviadoPor: string;
}) {
  const [m] = await sql`
    INSERT INTO col_wa_messages (client_id, contact_id, direccion, telefono, wamid, tipo, template_id, parametros, cuerpo, estado, error, origen, enviado_por, estado_actualizado_at)
    VALUES (${p.clientId}, ${p.contactId}, 'saliente', ${p.telefono}, ${p.wamid}, ${p.tipo}, ${p.templateId ?? null},
            ${p.parametros ? JSON.stringify(p.parametros) : null}::text::jsonb, ${p.cuerpo}, ${p.estado},
            ${p.error ? JSON.stringify(p.error) : null}::text::jsonb, 'chat', ${p.enviadoPor}, now())
    RETURNING id
  `;
  if (p.clientId && p.estado === "enviado") {
    await sql`
      INSERT INTO col_activities (client_id, tipo, descripcion, wa_message_id, actor)
      VALUES (${p.clientId}, 'whatsapp_enviado', ${`Respuesta por WhatsApp: "${(p.cuerpo ?? "").slice(0, 300)}"`}, ${m.id}, ${p.enviadoPor})
    `;
  }
  return m.id as number;
}

// ---------------------------------------------------------------- webhook

async function guardarEntrante(m: MensajeEntrante) {
  const cliente = await clienteDeTelefono(m.telefono);
  const [row] = await sql`
    INSERT INTO col_wa_messages (client_id, contact_id, direccion, telefono, wamid, tipo, cuerpo, estado, origen,
                                 perfil_nombre, media_id, media_mime, media_nombre, responde_a, created_at)
    VALUES (${cliente?.clientId ?? null}, ${cliente?.contactId ?? null}, 'entrante', ${m.telefono}, ${m.wamid}, ${m.tipo}, ${m.cuerpo},
            'recibido', 'cliente', ${m.perfilNombre}, ${m.media?.id ?? null}, ${m.media?.mime ?? null}, ${m.media?.nombre ?? null},
            ${m.respondeA}, ${m.recibidoAt})
    ON CONFLICT (wamid) DO NOTHING
    RETURNING id
  `;
  if (!row) return; // Meta reenvió un mensaje que ya teníamos

  if (cliente) {
    await sql`
      INSERT INTO col_activities (client_id, tipo, descripcion, wa_message_id, actor, ocurrido_at)
      VALUES (${cliente.clientId}, 'whatsapp_recibido', ${`WhatsApp del cliente: "${(m.cuerpo ?? "archivo").slice(0, 300)}"`}, ${row.id}, 'cliente', ${m.recibidoAt})
    `;
  }

  if (esBaja(m.cuerpo)) {
    await sql`UPDATE col_contacts SET baja_whatsapp_at = now() WHERE telefono_whatsapp = ${m.telefono} AND baja_whatsapp_at IS NULL`;
    if (cliente) {
      await sql`
        INSERT INTO col_activities (client_id, tipo, descripcion, actor)
        VALUES (${cliente.clientId}, 'cambio_contacto', 'Pidió por WhatsApp no recibir más mensajes: ya no recibe recordatorios en ese número', 'cliente')
      `;
    }
    const config = getWhatsAppConfig();
    if (config) {
      try {
        const { wamid } = await enviarTexto(config, { telefono: m.telefono, texto: CONFIRMACION_BAJA });
        await registrarSaliente({ telefono: m.telefono, clientId: cliente?.clientId ?? null, contactId: cliente?.contactId ?? null, tipo: "texto", cuerpo: CONFIRMACION_BAJA, wamid, estado: "enviado", enviadoPor: "sistema" });
      } catch (e) {
        console.error("Chat: no se pudo confirmar la baja:", (e as Error).message);
      }
    }
  }

  const quien = cliente?.nombre ?? m.perfilNombre ?? m.telefono;
  await notifySlack(`:speech_balloon: WhatsApp de ${quien}: "${(m.cuerpo ?? "archivo").slice(0, 200)}" → ${URL_BACKOFFICE}/cobranza/chat?t=${m.telefono}`);
}

/** Procesa un webhook de Meta: mensajes de clientes y estados de los mensajes enviados. */
export async function procesarWebhook(body: unknown): Promise<{ mensajes: number; estados: number }> {
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  if (!phoneNumberId) return { mensajes: 0, estados: 0 };
  const { mensajes, estados } = leerWebhook(body, phoneNumberId);
  for (const m of mensajes) await guardarEntrante(m);

  for (const s of estados) {
    // Solo avanza: un "entregado" que llega después de "leído" no lo regresa.
    const [m] = await sql`
      UPDATE col_wa_messages SET estado = ${s.estado}, estado_actualizado_at = ${s.at},
             error = CASE WHEN ${s.estado} = 'fallido' THEN ${s.error ? JSON.stringify(s.error) : null}::text::jsonb ELSE error END
      WHERE wamid = ${s.wamid} AND direccion = 'saliente'
        AND ${RANGO_ESTADO[s.estado]}::int > CASE estado WHEN 'enviado' THEN 1 WHEN 'entregado' THEN 2 WHEN 'leido' THEN 3 WHEN 'fallido' THEN 4 ELSE 0 END
      RETURNING client_id
    `;
    if (m?.client_id && s.estado === "fallido") {
      await transaccion((tx) =>
        openAlert(tx, m.client_id, null, {
          tipo: "mensaje_fallido",
          severidad: "atencion",
          dedupeKey: `mensaje_fallido:${m.client_id}`,
          detalle: { error: s.error?.mensaje ?? "Meta no entregó el mensaje", codigo: s.error?.code ?? null },
        }),
      );
    }
  }
  return { mensajes: mensajes.length, estados: estados.length };
}

// ---------------------------------------------------------------- bandeja

export interface Conversacion {
  telefono: string;
  clientId: string | null;
  cliente: string | null;
  perfilNombre: string | null;
  sinLeer: number;
  ultimo: { direccion: string; texto: string; at: string };
  ventanaAbierta: boolean;
}

const textoDe = (r: { tipo: string; cuerpo: string | null; plantilla: string | null; plantilla_cuerpo: string | null; parametros: string[] | null }) => {
  if (r.tipo === "plantilla") {
    return r.plantilla_cuerpo && r.parametros ? renderPlantilla(r.plantilla_cuerpo, r.parametros) : `Plantilla ${r.plantilla ?? ""}`.trim();
  }
  return r.cuerpo ?? "Archivo";
};

export async function listarConversaciones(p: { soloConRespuesta: boolean }): Promise<Conversacion[]> {
  const rows = await sql`
    WITH ult AS (
      SELECT DISTINCT ON (m.telefono) m.telefono, m.direccion, m.tipo, m.cuerpo, m.parametros, m.created_at,
             t.nombre AS plantilla, t.cuerpo AS plantilla_cuerpo
      FROM col_wa_messages m LEFT JOIN col_wa_templates t ON t.id = m.template_id
      ORDER BY m.telefono, m.created_at DESC, m.id DESC
    ),
    agg AS (
      SELECT telefono,
             count(*) FILTER (WHERE direccion = 'entrante' AND leido_equipo_at IS NULL)::int AS sin_leer,
             max(created_at) FILTER (WHERE direccion = 'entrante') AS ultima_entrante,
             (array_agg(client_id ORDER BY created_at DESC) FILTER (WHERE client_id IS NOT NULL))[1] AS client_id,
             (array_agg(perfil_nombre ORDER BY created_at DESC) FILTER (WHERE perfil_nombre IS NOT NULL))[1] AS perfil
      FROM col_wa_messages GROUP BY telefono
    )
    SELECT u.*, a.sin_leer, a.ultima_entrante, a.client_id, a.perfil, c.nombre AS cliente
    FROM ult u JOIN agg a USING (telefono)
    LEFT JOIN col_clients c ON c.id = a.client_id
    WHERE ${!p.soloConRespuesta} OR a.ultima_entrante IS NOT NULL
    ORDER BY a.sin_leer > 0 DESC, u.created_at DESC
    LIMIT 200
  `;
  return rows.map((r) => ({
    telefono: r.telefono,
    clientId: r.client_id,
    cliente: r.cliente,
    perfilNombre: r.perfil,
    sinLeer: r.sin_leer,
    ultimo: { direccion: r.direccion, texto: textoDe(r as never), at: (r.created_at as Date).toISOString() },
    ventanaAbierta: ventana(r.ultima_entrante ?? null).abierta,
  }));
}

export interface MensajeChat {
  id: number;
  direccion: "entrante" | "saliente";
  texto: string;
  esPlantilla: boolean;
  plantilla: string | null;
  estado: string;
  error: string | null;
  origen: string;
  enviadoPor: string | null;
  at: string;
  media: { id: string; mime: string | null; nombre: string | null } | null;
}

export interface ConversacionDetalle {
  telefono: string;
  cliente: { id: string; nombre: string } | null;
  perfilNombre: string | null;
  /** Algún contacto con ese número pidió no recibir mensajes. */
  dadoDeBaja: boolean;
  ventana: { abierta: boolean; cierraAt: string | null };
  mensajes: MensajeChat[];
  /** Plantilla para retomar, si Meta ya la aprobó. */
  retomarDisponible: boolean;
}

export async function conversacion(telefono: string): Promise<ConversacionDetalle | null> {
  const mensajes = await sql`
    SELECT * FROM (
      SELECT m.id, m.direccion, m.tipo, m.cuerpo, m.parametros, m.estado, m.error->>'mensaje' AS error_mensaje,
             m.error->>'detalles' AS error_detalles, m.origen, m.enviado_por, m.created_at, m.media_id, m.media_mime, m.media_nombre,
             m.client_id, m.perfil_nombre, t.nombre AS plantilla, t.cuerpo AS plantilla_cuerpo
      FROM col_wa_messages m LEFT JOIN col_wa_templates t ON t.id = m.template_id
      WHERE m.telefono = ${telefono}
      ORDER BY m.created_at DESC, m.id DESC LIMIT 300
    ) x ORDER BY created_at, id
  `;
  if (mensajes.length === 0) return null;
  const clientId = [...mensajes].reverse().find((m) => m.client_id)?.client_id ?? (await clienteDeTelefono(telefono))?.clientId ?? null;
  const [[cliente], [baja], [contacto]] = await Promise.all([
    clientId ? sql`SELECT id, nombre FROM col_clients WHERE id = ${clientId}` : Promise.resolve([undefined]),
    sql`SELECT EXISTS (SELECT 1 FROM col_contacts WHERE telefono_whatsapp = ${telefono} AND baja_whatsapp_at IS NOT NULL) AS b`,
    sql`SELECT estado_meta, cuerpo, jsonb_array_length(variables) AS variables FROM col_wa_templates WHERE nombre = ${PLANTILLA_CONTACTO.nombre}`,
  ]);
  const ultimaEntrante = [...mensajes].reverse().find((m) => m.direccion === "entrante");
  const v = ventana(ultimaEntrante ? (ultimaEntrante.created_at as Date) : null);
  return {
    telefono,
    cliente: cliente ? { id: cliente.id, nombre: cliente.nombre } : null,
    perfilNombre: [...mensajes].reverse().find((m) => m.perfil_nombre)?.perfil_nombre ?? null,
    dadoDeBaja: baja.b,
    ventana: { abierta: v.abierta, cierraAt: v.cierraAt ? v.cierraAt.toISOString() : null },
    mensajes: mensajes.map((m) => ({
      id: Number(m.id),
      direccion: m.direccion,
      texto: textoDe(m as never),
      esPlantilla: m.tipo === "plantilla",
      plantilla: m.plantilla,
      estado: m.estado,
      error: m.error_detalles || m.error_mensaje || null,
      origen: m.origen,
      enviadoPor: m.enviado_por,
      at: (m.created_at as Date).toISOString(),
      media: m.media_id ? { id: m.media_id, mime: m.media_mime, nombre: m.media_nombre } : null,
    })),
    retomarDisponible: !!contacto && motivoNoActivable({ estadoMeta: contacto.estado_meta, cuerpo: contacto.cuerpo, variables: contacto.variables }) === null,
  };
}

export async function marcarLeida(telefono: string) {
  await sql`UPDATE col_wa_messages SET leido_equipo_at = now() WHERE telefono = ${telefono} AND direccion = 'entrante' AND leido_equipo_at IS NULL`;
}

// ---------------------------------------------------------------- respuestas del equipo

export async function responder(p: { telefono: string; texto: string; actor: string }) {
  const texto = p.texto.trim();
  if (!texto) throw new ChatError("Escribe un mensaje");
  if (texto.length > MAX_TEXTO) throw new ChatError(`Máximo ${MAX_TEXTO} caracteres`);
  const config = getWhatsAppConfig();
  if (!config) throw new ChatError("Faltan las variables de WhatsApp en Vercel");
  const detalle = await conversacion(p.telefono);
  if (!detalle) throw new ChatError("No encontramos esa conversación");
  if (!detalle.ventana.abierta) throw new ChatError("Pasaron más de 24 horas desde el último mensaje del cliente: Meta solo deja escribirle con una plantilla.");

  const cliente = await clienteDeTelefono(p.telefono);
  try {
    const { wamid } = await enviarTexto(config, { telefono: p.telefono, texto });
    await registrarSaliente({ telefono: p.telefono, clientId: detalle.cliente?.id ?? null, contactId: cliente?.contactId ?? null, tipo: "texto", cuerpo: texto, wamid, estado: "enviado", enviadoPor: p.actor });
  } catch (e) {
    const err = e instanceof WhatsAppError ? e : new WhatsAppError((e as Error).message, null, {});
    await registrarSaliente({ telefono: p.telefono, clientId: detalle.cliente?.id ?? null, contactId: cliente?.contactId ?? null, tipo: "texto", cuerpo: texto, wamid: null, estado: "fallido", error: err.detalle, enviadoPor: p.actor });
    throw new ChatError(err.message);
  }
  await marcarLeida(p.telefono);
}

/** Pasadas las 24 h: manda la plantilla finbra_contacto para que el cliente conteste. */
export async function retomar(p: { telefono: string; actor: string }) {
  const config = getWhatsAppConfig();
  if (!config) throw new ChatError("Faltan las variables de WhatsApp en Vercel");
  const detalle = await conversacion(p.telefono);
  if (!detalle) throw new ChatError("No encontramos esa conversación");
  if (detalle.dadoDeBaja) throw new ChatError("Este número pidió no recibir mensajes");
  const [t] = await sql`SELECT id, nombre, idioma, cuerpo, estado_meta, jsonb_array_length(variables) AS variables FROM col_wa_templates WHERE nombre = ${PLANTILLA_CONTACTO.nombre}`;
  const motivo = t ? motivoNoActivable({ estadoMeta: t.estado_meta, cuerpo: t.cuerpo, variables: t.variables }) : "No existe la plantilla";
  if (motivo) throw new ChatError(`La plantilla para retomar no está lista: ${motivo}`);

  const cliente = await clienteDeTelefono(p.telefono);
  const parametros = [detalle.perfilNombre ?? detalle.cliente?.nombre ?? "cliente"];
  try {
    const { wamid } = await enviarPlantilla(config, { telefono: p.telefono, plantilla: t.nombre, idioma: t.idioma, parametros });
    await registrarSaliente({ telefono: p.telefono, clientId: detalle.cliente?.id ?? null, contactId: cliente?.contactId ?? null, tipo: "plantilla", cuerpo: renderPlantilla(t.cuerpo, parametros), templateId: t.id, parametros, wamid, estado: "enviado", enviadoPor: p.actor });
  } catch (e) {
    const err = e instanceof WhatsAppError ? e : new WhatsAppError((e as Error).message, null, {});
    throw new ChatError(err.message);
  }
}

/** Marca (o quita) la baja de WhatsApp de todos los contactos con ese número. */
export async function setBaja(p: { telefono: string; baja: boolean; actor: string }) {
  const r = await sql`
    UPDATE col_contacts SET baja_whatsapp_at = ${p.baja ? sql`now()` : null}, updated_by = ${p.actor}, updated_at = now()
    WHERE telefono_whatsapp = ${p.telefono}
    RETURNING client_id
  `;
  if (r.count === 0) throw new ChatError("Ese número no está en los contactos de ningún cliente");
  for (const clientId of new Set(r.map((x) => x.client_id as string))) {
    await sql`
      INSERT INTO col_activities (client_id, tipo, descripcion, actor)
      VALUES (${clientId}, 'cambio_contacto', ${p.baja ? "Se marcó que no quiere recibir WhatsApp en ese número" : "Se reactivaron los WhatsApp en ese número"}, ${p.actor})
    `;
  }
  await logAudit({ actorEmail: p.actor, action: p.baja ? "cobranza_whatsapp_baja" : "cobranza_whatsapp_reactivado", entityType: "col_contacts", metadata: { telefonoTermina: p.telefono.slice(-4) } });
}

/** Archivo que mandó el cliente; solo si está en un mensaje nuestro. */
export async function archivoDeMensaje(mediaId: string): Promise<{ mime: string; datos: ArrayBuffer; nombre: string | null }> {
  const [m] = await sql`SELECT media_nombre FROM col_wa_messages WHERE media_id = ${mediaId} LIMIT 1`;
  if (!m) throw new ChatError("No encontramos ese archivo");
  const config = getWhatsAppConfig();
  if (!config) throw new ChatError("Faltan las variables de WhatsApp en Vercel");
  const r = await descargarMedia(config, mediaId);
  return { ...r, nombre: m.media_nombre };
}

/** Estado de la plantilla para retomar conversaciones (null si no está en la base). */
export async function plantillaContacto(): Promise<{ estadoMeta: string; tieneTexto: boolean } | null> {
  const [t] = await sql`SELECT estado_meta, cuerpo IS NOT NULL AS tiene_texto FROM col_wa_templates WHERE nombre = ${PLANTILLA_CONTACTO.nombre}`;
  return t ? { estadoMeta: t.estado_meta, tieneTexto: t.tiene_texto } : null;
}
