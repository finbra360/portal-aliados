// Cliente mínimo de la API de WhatsApp Cloud de Meta: solo manda plantillas.
// Usa el mismo número que el flujo "Agente Finbra Cobranza" de n8n. El token
// es un secreto: nunca va en errores ni en logs.

export interface WhatsAppConfig {
  token: string;
  phoneNumberId: string;
  apiVersion: string;
  /** Solo se cambia para pruebas locales contra un Meta simulado. */
  baseUrl: string;
}

export function getWhatsAppConfig(): WhatsAppConfig | null {
  const token = process.env.WHATSAPP_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  if (!token || !phoneNumberId) return null;
  return {
    token,
    phoneNumberId,
    apiVersion: process.env.WHATSAPP_API_VERSION || "v20.0",
    baseUrl: (process.env.WHATSAPP_API_BASE_URL || "https://graph.facebook.com").replace(/\/$/, ""),
  };
}

export class WhatsAppError extends Error {
  /** Código de error de Meta (ej. 132001 plantilla inexistente, 131026 no entregable), o null si no respondió. */
  readonly code: number | null;
  /** Respuesta de Meta sin datos sensibles, para guardarla en col_wa_messages.error. */
  readonly detalle: Record<string, unknown>;

  constructor(message: string, code: number | null, detalle: Record<string, unknown>) {
    super(message);
    this.code = code;
    this.detalle = detalle;
  }
}

/** Errores de plantilla o de credenciales: afectan a todos los envíos, no solo a uno. */
export const esErrorGeneral = (code: number | null) => code !== null && (code === 190 || code === 10 || code === 200 || (code >= 132000 && code < 133000));

export async function enviarPlantilla(
  config: WhatsAppConfig,
  p: { telefono: string; plantilla: string; idioma: string; parametros: string[] },
): Promise<{ wamid: string }> {
  let res: Response;
  try {
    res = await fetch(`${config.baseUrl}/${config.apiVersion}/${config.phoneNumberId}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${config.token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: p.telefono,
        type: "template",
        template: {
          name: p.plantilla,
          language: { code: p.idioma },
          components: [{ type: "body", parameters: p.parametros.map((text) => ({ type: "text", text })) }],
        },
      }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch (e) {
    throw new WhatsAppError(`Meta no respondió: ${(e as Error).name}`, null, { tipo: (e as Error).name });
  }

  const body = (await res.json().catch(() => null)) as {
    messages?: { id: string }[];
    error?: { message?: string; code?: number; error_subcode?: number; error_data?: { details?: string } };
  } | null;
  const wamid = body?.messages?.[0]?.id;
  if (res.ok && wamid) return { wamid };

  const err = body?.error;
  const code = typeof err?.code === "number" ? err.code : null;
  const detalle = { status: res.status, code, subcode: err?.error_subcode ?? null, mensaje: err?.message ?? null, detalles: err?.error_data?.details ?? null };
  throw new WhatsAppError(`Meta rechazó el mensaje${code ? ` (${code})` : ""}: ${err?.error_data?.details || err?.message || `HTTP ${res.status}`}`, code, detalle);
}
