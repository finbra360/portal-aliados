// Chat de WhatsApp de Aliados (+52 55 9990 0795). Lo que escriben los aliados
// llega por el mismo webhook que cobranza (misma app de Meta) y aquí se separa
// por número: se guarda en ali_wa_messages, se avisa a Slack y el equipo
// comercial lo lee y contesta desde Brokers → Chat de aliados.

import { sql } from "@/lib/db";
import { logAudit } from "@/lib/db/audit";
import { notifySlackAliados } from "@/lib/collections/notify";
import { normalizePhoneMx } from "@/lib/collections/rules";
import { RANGO_ESTADO, leerWebhook, ventana, type MensajeEntrante } from "@/lib/collections/chat";
import { WhatsAppError, aliadosPhoneNumberId, consultarNumero, descargarMedia, enviarTexto, getWhatsAppAliadosConfig } from "@/lib/whatsapp/client";

export class ChatAliadosError extends Error {}

const URL_CHAT = "https://backoffice.finbra.com/backoffice/brokers/chat";
const MAX_TEXTO = 4096;

/** El broker con ese teléfono (comparando 52 + 10 dígitos), si es uno solo. */
async function brokerPorTelefono(telefono: string): Promise<{ id: string; nombre: string } | null> {
  const rows = await sql`SELECT id, nombre, telefono FROM brokers WHERE telefono IS NOT NULL`;
  const iguales = rows.filter((b) => normalizePhoneMx(b.telefono) === telefono);
  return iguales.length === 1 ? { id: iguales[0].id, nombre: iguales[0].nombre } : null;
}

async function guardarEntrante(m: MensajeEntrante) {
  const broker = await brokerPorTelefono(m.telefono);
  const [row] = await sql`
    INSERT INTO ali_wa_messages (telefono, broker_id, perfil_nombre, direccion, tipo, cuerpo, media, wamid, responde_a, estado, created_at)
    VALUES (${m.telefono}, ${broker?.id ?? null}, ${m.perfilNombre}, 'entrante', ${m.tipo}, ${m.cuerpo},
            ${m.media ? JSON.stringify(m.media) : null}::text::jsonb, ${m.wamid}, ${m.respondeA}, 'recibido', ${m.recibidoAt})
    ON CONFLICT (wamid) DO NOTHING
    RETURNING id
  `;
  if (!row) return; // Meta reenvió un mensaje que ya teníamos
  const quien = broker ? `${broker.nombre} (aliado ${broker.id})` : (m.perfilNombre ?? "Alguien que no está en Brokers");
  const texto = (m.cuerpo ?? (m.media ? "archivo" : "mensaje")).replace(/\s+/g, " ").slice(0, 200);
  await notifySlackAliados(`:speech_balloon: WhatsApp de aliados — ${quien}, ${m.telefono}: "${texto}" → <${URL_CHAT}?t=${m.telefono}|Contestar>`);
}

/**
 * Procesa la parte del webhook que es del número de Aliados. Nunca truena el
 * webhook de cobranza: quien lo llama atrapa cualquier error.
 */
export async function procesarWebhookAliados(body: unknown): Promise<{ mensajes: number; estados: number }> {
  const { mensajes, estados } = leerWebhook(body, aliadosPhoneNumberId());
  for (const m of mensajes) await guardarEntrante(m);
  for (const s of estados) {
    // Solo los mensajes que mandó el backoffice; los de n8n no están en la tabla. Solo avanza.
    await sql`
      UPDATE ali_wa_messages SET estado = ${s.estado}, estado_actualizado_at = ${s.at},
             error = CASE WHEN ${s.estado} = 'fallido' THEN ${s.error ? JSON.stringify(s.error) : null}::text::jsonb ELSE error END
      WHERE wamid = ${s.wamid} AND direccion = 'saliente'
        AND ${RANGO_ESTADO[s.estado]}::int > CASE estado WHEN 'enviado' THEN 1 WHEN 'entregado' THEN 2 WHEN 'leido' THEN 3 WHEN 'fallido' THEN 4 ELSE 0 END
    `;
  }
  return { mensajes: mensajes.length, estados: estados.length };
}

// ---------------------------------------------------------------- bandeja

export interface ConversacionAliado {
  telefono: string;
  nombre: string;
  brokerId: string | null;
  ultimo: string | null;
  ultimoAt: string;
  sinLeer: number;
}

export async function conversacionesAliados(): Promise<ConversacionAliado[]> {
  const rows = await sql`
    SELECT m.telefono,
           (array_agg(b.nombre ORDER BY m.created_at DESC) FILTER (WHERE b.nombre IS NOT NULL))[1] AS broker,
           (array_agg(m.broker_id ORDER BY m.created_at DESC) FILTER (WHERE m.broker_id IS NOT NULL))[1] AS broker_id,
           (array_agg(m.perfil_nombre ORDER BY m.created_at DESC) FILTER (WHERE m.perfil_nombre IS NOT NULL))[1] AS perfil,
           (array_agg(coalesce(m.cuerpo, CASE WHEN m.media IS NOT NULL THEN 'Archivo' END) ORDER BY m.created_at DESC))[1] AS ultimo,
           max(m.created_at) AS ultimo_at,
           count(*) FILTER (WHERE m.direccion = 'entrante' AND m.leido_equipo_at IS NULL)::int AS sin_leer
    FROM ali_wa_messages m LEFT JOIN brokers b ON b.id = m.broker_id
    GROUP BY m.telefono
    ORDER BY max(m.created_at) DESC
    LIMIT 200
  `;
  return rows.map((r) => ({
    telefono: r.telefono,
    nombre: r.broker ?? r.perfil ?? r.telefono,
    brokerId: r.broker_id,
    ultimo: r.ultimo,
    ultimoAt: (r.ultimo_at as Date).toISOString(),
    sinLeer: r.sin_leer,
  }));
}

export interface MensajeAliado {
  id: number;
  direccion: "entrante" | "saliente";
  cuerpo: string | null;
  media: { id: string; mime: string | null; nombre: string | null } | null;
  estado: string;
  error: string | null;
  enviadoPor: string | null;
  at: string;
}

export async function conversacionAliado(telefono: string): Promise<{ mensajes: MensajeAliado[]; ventanaAbierta: boolean; cierraAt: string | null }> {
  const rows = await sql`
    SELECT id, direccion, cuerpo, media, estado, error->>'mensaje' AS error, enviado_por, created_at
    FROM ali_wa_messages WHERE telefono = ${telefono} ORDER BY created_at, id LIMIT 500
  `;
  const mensajes = rows.map((m) => ({
    id: Number(m.id),
    direccion: m.direccion,
    cuerpo: m.cuerpo,
    media: m.media,
    estado: m.estado,
    error: m.error,
    enviadoPor: m.enviado_por,
    at: (m.created_at as Date).toISOString(),
  }));
  const ultimaEntrante = [...mensajes].reverse().find((m) => m.direccion === "entrante");
  const v = ventana(ultimaEntrante ? new Date(ultimaEntrante.at) : null);
  return { mensajes, ventanaAbierta: v.abierta, cierraAt: v.cierraAt ? v.cierraAt.toISOString() : null };
}

export async function marcarLeidoAliado(p: { telefono: string; actor: string }) {
  await sql`UPDATE ali_wa_messages SET leido_equipo_at = now() WHERE telefono = ${p.telefono} AND direccion = 'entrante' AND leido_equipo_at IS NULL`;
}

/** Contesta con texto libre (solo dentro de las 24 h desde el último mensaje del aliado). */
export async function responderAliado(p: { telefono: string; texto: string; actor: string }) {
  const texto = p.texto.trim();
  if (!texto) throw new ChatAliadosError("Escribe el mensaje");
  if (texto.length > MAX_TEXTO) throw new ChatAliadosError(`El mensaje es demasiado largo (máximo ${MAX_TEXTO} caracteres)`);
  const config = getWhatsAppAliadosConfig();
  if (!config) throw new ChatAliadosError("Falta el token de WhatsApp de Aliados en Vercel (WHATSAPP_ALIADOS_TOKEN)");
  const { ventanaAbierta } = await conversacionAliado(p.telefono);
  if (!ventanaAbierta) throw new ChatAliadosError("Pasaron más de 24 h desde su último mensaje: WhatsApp solo deja contestar con texto libre dentro de esa ventana");

  const broker = await brokerPorTelefono(p.telefono);
  const [msg] = await sql`
    INSERT INTO ali_wa_messages (telefono, broker_id, direccion, tipo, cuerpo, estado, enviado_por)
    VALUES (${p.telefono}, ${broker?.id ?? null}, 'saliente', 'texto', ${texto}, 'pendiente', ${p.actor})
    RETURNING id
  `;
  try {
    const { wamid } = await enviarTexto(config, { telefono: p.telefono, texto });
    await sql`UPDATE ali_wa_messages SET estado = 'enviado', wamid = ${wamid}, estado_actualizado_at = now() WHERE id = ${msg.id}`;
  } catch (e) {
    const err = e instanceof WhatsAppError ? e : new WhatsAppError((e as Error).message, null, {});
    await sql`UPDATE ali_wa_messages SET estado = 'fallido', error = ${JSON.stringify({ ...err.detalle, mensaje: err.message })}::text::jsonb, estado_actualizado_at = now() WHERE id = ${msg.id}`;
    throw new ChatAliadosError(`Meta no aceptó el mensaje: ${err.message}`);
  }
  await marcarLeidoAliado({ telefono: p.telefono, actor: p.actor });
  await logAudit({ actorEmail: p.actor, action: "aliados_whatsapp_respuesta", entityType: "ali_wa_messages", entityId: String(msg.id), metadata: { telefonoTermina: p.telefono.slice(-4) } });
}

/** Foto o documento que mandó un aliado, descargado de Meta en el momento (no se guarda copia). */
export async function archivoAliado(id: string): Promise<{ mime: string; datos: ArrayBuffer; nombre: string | null }> {
  const [m] = await sql`SELECT media FROM ali_wa_messages WHERE id = ${id} AND media IS NOT NULL`;
  if (!m) throw new ChatAliadosError("No encontramos ese archivo");
  const config = getWhatsAppAliadosConfig();
  if (!config) throw new ChatAliadosError("Falta el token de WhatsApp de Aliados");
  const a = await descargarMedia(config, m.media.id);
  return { ...a, nombre: m.media.nombre ?? null };
}

/** ¿El token puede usar el número de Aliados? Para mostrarlo en la pantalla. */
export async function estadoConexionAliados(): Promise<{ ok: boolean; detalle: string }> {
  const config = getWhatsAppAliadosConfig();
  if (!config) return { ok: false, detalle: "Falta WHATSAPP_ALIADOS_TOKEN en Vercel: se pueden leer los mensajes, pero no contestar." };
  try {
    const n = await consultarNumero(config);
    return { ok: true, detalle: `Conectado a ${n.numero ?? "el número de Aliados"}${config.tokenPropio ? "" : " (con el token de cobranza)"}.` };
  } catch (e) {
    const m = e instanceof WhatsAppError ? e.message : "no respondió";
    return {
      ok: false,
      detalle: config.tokenPropio
        ? `El token de Aliados no funcionó: ${m}`
        : `El token de cobranza no tiene acceso al número de Aliados (${m}). Agrega WHATSAPP_ALIADOS_TOKEN en Vercel para poder contestar.`,
    };
  }
}
