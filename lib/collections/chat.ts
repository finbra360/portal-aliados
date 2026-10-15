// Chat de WhatsApp en el backoffice: cómo leer lo que manda Meta (webhook) y
// las reglas de la conversación. Funciones puras, sin base de datos ni red,
// para probarlas con `node --test`.

import { normalizePhoneMx } from "./rules.ts";

/** Meta deja escribir texto libre solo dentro de las 24 h siguientes al último mensaje del cliente. */
export const HORAS_VENTANA = 24;

export function ventana(ultimaEntrante: Date | null, ahora: Date = new Date()): { abierta: boolean; cierraAt: Date | null } {
  if (!ultimaEntrante) return { abierta: false, cierraAt: null };
  const cierraAt = new Date(ultimaEntrante.getTime() + HORAS_VENTANA * 3_600_000);
  return { abierta: ahora < cierraAt, cierraAt };
}

/** "BAJA", "stop", "Alto." — el cliente pide no recibir más mensajes. */
export function esBaja(texto: string | null): boolean {
  if (!texto) return false;
  return /^\s*(baja|stop|alto|cancelar suscripci[oó]n|ya no me escriban)\s*[.!]*\s*$/i.test(texto);
}

export interface MensajeEntrante {
  wamid: string;
  /** Teléfono normalizado como en col_contacts.telefono_whatsapp (52 + 10 dígitos), o el original si no es de México. */
  telefono: string;
  perfilNombre: string | null;
  recibidoAt: Date;
  tipo: "texto" | "otro";
  /** Texto, pie de foto, o una descripción ("Ubicación", "Audio"…). */
  cuerpo: string | null;
  media: { id: string; mime: string | null; nombre: string | null } | null;
  /** wamid del mensaje al que responde, si es respuesta. */
  respondeA: string | null;
}

export type EstadoMensaje = "enviado" | "entregado" | "leido" | "fallido";

export interface EstadoEntrante {
  wamid: string;
  estado: EstadoMensaje;
  at: Date;
  error: { code: number | null; mensaje: string | null } | null;
}

/** Orden de los estados: uno que llega tarde (entregado después de leído) no hace retroceder. */
export const RANGO_ESTADO: Record<string, number> = { pendiente: 0, enviado: 1, entregado: 2, leido: 3, fallido: 4 };

const ESTADOS_META: Record<string, EstadoMensaje> = { sent: "enviado", delivered: "entregado", read: "leido", failed: "fallido" };

const DESCRIPCION: Record<string, string> = {
  audio: "Audio",
  video: "Video",
  sticker: "Sticker",
  location: "Ubicación",
  contacts: "Contacto compartido",
  reaction: "Reacción",
  unsupported: "Mensaje no soportado",
};

type MetaMensaje = {
  id: string;
  from: string;
  timestamp: string;
  type: string;
  text?: { body?: string };
  image?: { id: string; mime_type?: string; caption?: string };
  document?: { id: string; mime_type?: string; caption?: string; filename?: string };
  audio?: { id: string; mime_type?: string };
  video?: { id: string; mime_type?: string; caption?: string };
  button?: { text?: string };
  interactive?: { button_reply?: { title?: string }; list_reply?: { title?: string } };
  reaction?: { emoji?: string };
  context?: { id?: string };
};

function leerMensaje(m: MetaMensaje, perfil: Map<string, string>): MensajeEntrante {
  const media = m.image ?? m.document ?? m.audio ?? m.video ?? null;
  let cuerpo: string | null = null;
  if (m.type === "text") cuerpo = m.text?.body ?? null;
  else if (m.type === "image" || m.type === "video") cuerpo = (media as { caption?: string })?.caption ?? null;
  else if (m.type === "document") cuerpo = m.document?.caption ?? m.document?.filename ?? null;
  else if (m.type === "button") cuerpo = m.button?.text ?? null;
  else if (m.type === "interactive") cuerpo = m.interactive?.button_reply?.title ?? m.interactive?.list_reply?.title ?? null;
  else if (m.type === "reaction") cuerpo = m.reaction?.emoji ? `Reacción: ${m.reaction.emoji}` : "Reacción";
  else cuerpo = DESCRIPCION[m.type] ?? null;
  return {
    wamid: m.id,
    telefono: normalizePhoneMx(m.from) ?? m.from,
    perfilNombre: perfil.get(m.from) ?? null,
    recibidoAt: new Date(Number(m.timestamp) * 1000),
    tipo: m.type === "text" || m.type === "button" || m.type === "interactive" ? "texto" : "otro",
    cuerpo,
    media: media ? { id: media.id, mime: media.mime_type ?? null, nombre: m.document?.filename ?? null } : null,
    respondeA: m.context?.id ?? null,
  };
}

/**
 * Lee el cuerpo del webhook de Meta. Solo toma lo que es de nuestro número
 * (phone_number_id): el resto se ignora.
 */
export function leerWebhook(body: unknown, phoneNumberId: string): { mensajes: MensajeEntrante[]; estados: EstadoEntrante[] } {
  const mensajes: MensajeEntrante[] = [];
  const estados: EstadoEntrante[] = [];
  const entries = (body as { object?: string; entry?: unknown[] })?.entry ?? [];
  for (const entry of entries as { changes?: { field?: string; value?: Record<string, unknown> }[] }[]) {
    for (const change of entry.changes ?? []) {
      const v = change.value as {
        metadata?: { phone_number_id?: string };
        contacts?: { wa_id: string; profile?: { name?: string } }[];
        messages?: MetaMensaje[];
        statuses?: { id: string; status: string; timestamp: string; errors?: { code?: number; title?: string; message?: string; error_data?: { details?: string } }[] }[];
      };
      if (change.field !== "messages" || v?.metadata?.phone_number_id !== phoneNumberId) continue;
      const perfil = new Map((v.contacts ?? []).filter((c) => c.profile?.name).map((c) => [c.wa_id, c.profile!.name!]));
      for (const m of v.messages ?? []) mensajes.push(leerMensaje(m, perfil));
      for (const s of v.statuses ?? []) {
        const estado = ESTADOS_META[s.status];
        if (!estado) continue;
        const e = s.errors?.[0];
        estados.push({
          wamid: s.id,
          estado,
          at: new Date(Number(s.timestamp) * 1000),
          error: e ? { code: e.code ?? null, mensaje: e.error_data?.details || e.message || e.title || null } : null,
        });
      }
    }
  }
  return { mensajes, estados };
}

/** Plantilla para retomar la conversación cuando ya pasaron 24 h. {{1}} nombre. */
export const PLANTILLA_CONTACTO = {
  nombre: "finbra_contacto",
  cuerpo: "Hola {{1}}, te escribimos de Finbra sobre tu crédito. ¿Tienes un momento para platicar? Responde este mensaje y con gusto te atendemos.",
};
export const EJEMPLO_CONTACTO = ["Juan Pérez"];
