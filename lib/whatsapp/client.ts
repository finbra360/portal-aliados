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

type MetaError = { message?: string; code?: number; error_subcode?: number; error_data?: { details?: string } };

/** Llama a la Graph API. Errores de red o de Meta salen como WhatsAppError, sin el token. */
async function llamarMeta<T>(
  config: WhatsAppConfig,
  p: { metodo: "GET" | "POST"; ruta: string; query?: Record<string, string>; body?: unknown; queHacia: string },
): Promise<T> {
  const url = new URL(`${config.baseUrl}/${config.apiVersion}/${p.ruta}`);
  for (const [k, v] of Object.entries(p.query ?? {})) url.searchParams.set(k, v);
  let res: Response;
  try {
    res = await fetch(url, {
      method: p.metodo,
      headers: { Authorization: `Bearer ${config.token}`, ...(p.body ? { "Content-Type": "application/json" } : {}) },
      body: p.body ? JSON.stringify(p.body) : undefined,
      signal: AbortSignal.timeout(15_000),
    });
  } catch (e) {
    throw new WhatsAppError(`Meta no respondió: ${(e as Error).name}`, null, { tipo: (e as Error).name });
  }
  const body = (await res.json().catch(() => null)) as (T & { error?: MetaError }) | null;
  if (res.ok && body && !body.error) return body;

  const err = body?.error;
  const code = typeof err?.code === "number" ? err.code : null;
  const detalle = { status: res.status, code, subcode: err?.error_subcode ?? null, mensaje: err?.message ?? null, detalles: err?.error_data?.details ?? null };
  throw new WhatsAppError(`Meta rechazó ${p.queHacia}${code ? ` (${code})` : ""}: ${err?.error_data?.details || err?.message || `HTTP ${res.status}`}`, code, detalle);
}

export async function enviarPlantilla(
  config: WhatsAppConfig,
  p: { telefono: string; plantilla: string; idioma: string; parametros: string[] },
): Promise<{ wamid: string }> {
  const r = await llamarMeta<{ messages?: { id: string }[] }>(config, {
    metodo: "POST",
    ruta: `${config.phoneNumberId}/messages`,
    queHacia: "el mensaje",
    body: {
      messaging_product: "whatsapp",
      to: p.telefono,
      type: "template",
      template: {
        name: p.plantilla,
        language: { code: p.idioma },
        components: [{ type: "body", parameters: p.parametros.map((text) => ({ type: "text", text })) }],
      },
    },
  });
  const wamid = r.messages?.[0]?.id;
  if (!wamid) throw new WhatsAppError("Meta no regresó el ID del mensaje", null, {});
  return { wamid };
}

// ---------------------------------------------------------------- lecturas (no envían nada)

export interface NumeroMeta {
  numero: string | null;
  nombreVerificado: string | null;
  /** GREEN, YELLOW, RED o UNKNOWN. */
  calidad: string | null;
}

/** Datos del número de WhatsApp. Sirve para comprobar que el token y el número funcionan. */
export async function consultarNumero(config: WhatsAppConfig): Promise<NumeroMeta> {
  const r = await llamarMeta<{ display_phone_number?: string; verified_name?: string; quality_rating?: string }>(config, {
    metodo: "GET",
    ruta: config.phoneNumberId,
    query: { fields: "display_phone_number,verified_name,quality_rating" },
    queHacia: "la consulta del número",
  });
  return { numero: r.display_phone_number ?? null, nombreVerificado: r.verified_name ?? null, calidad: r.quality_rating ?? null };
}

/**
 * ID de la cuenta de WhatsApp Business (WABA), donde viven las plantillas.
 * WHATSAPP_BUSINESS_ACCOUNT_ID si está; si no, se lee de los permisos del
 * propio token (debug_token: granular_scopes de whatsapp_business_management).
 */
export async function obtenerCuentaWhatsApp(config: WhatsAppConfig): Promise<string> {
  const deEnv = process.env.WHATSAPP_BUSINESS_ACCOUNT_ID;
  if (deEnv) return deEnv;
  const r = await llamarMeta<{ data?: { granular_scopes?: { scope: string; target_ids?: string[] }[] } }>(config, {
    metodo: "GET",
    ruta: "debug_token",
    query: { input_token: config.token },
    queHacia: "la consulta de permisos del token",
  });
  const ids = r.data?.granular_scopes?.find((g) => g.scope === "whatsapp_business_management")?.target_ids ?? [];
  if (ids.length !== 1) {
    throw new WhatsAppError(
      ids.length === 0
        ? "Meta no dijo a qué cuenta de WhatsApp Business pertenece el token: agrega WHATSAPP_BUSINESS_ACCOUNT_ID en Vercel"
        : "El token tiene acceso a varias cuentas de WhatsApp: agrega WHATSAPP_BUSINESS_ACCOUNT_ID en Vercel",
      null,
      { cuentas: ids.length },
    );
  }
  return ids[0];
}

/**
 * Qué permisos tiene el token y sobre qué cuentas, en una línea legible. Sirve
 * para diagnosticar un rechazo de Meta. No incluye el token.
 */
export async function diagnosticoToken(config: WhatsAppConfig): Promise<string> {
  const r = await llamarMeta<{
    data?: { is_valid?: boolean; app_id?: string; expires_at?: number; scopes?: string[]; granular_scopes?: { scope: string; target_ids?: string[] }[] };
  }>(config, { metodo: "GET", ruta: "debug_token", query: { input_token: config.token }, queHacia: "la consulta de permisos del token" });
  const d = r.data ?? {};
  const permisos = (d.scopes ?? [])
    .filter((s) => s.startsWith("whatsapp") || s === "business_management")
    .map((s) => {
      const g = d.granular_scopes?.find((x) => x.scope === s);
      const cuentas = g?.target_ids?.length ? g.target_ids.join(", ") : "todas las asignadas";
      return `${s} (cuentas: ${cuentas})`;
    });
  const vence = d.expires_at ? new Date(d.expires_at * 1000).toISOString().slice(0, 10) : "nunca";
  return `Token ${d.is_valid ? "válido" : "NO válido"} de la app ${d.app_id ?? "?"}, vence ${vence}. Permisos: ${permisos.length ? permisos.join("; ") : "ninguno de WhatsApp"}.`;
}

export interface PlantillaMeta {
  nombre: string;
  idioma: string;
  /** APPROVED, PENDING, REJECTED, PAUSED, DISABLED… */
  estado: string;
  categoria: string | null;
  cuerpo: string | null;
  motivoRechazo: string | null;
}

/** Plantillas de la cuenta de WhatsApp con esos nombres (puede haber una por idioma). */
export async function consultarPlantillas(config: WhatsAppConfig, cuentaId: string, nombres: string[]): Promise<PlantillaMeta[]> {
  const r = await llamarMeta<{
    data?: { name: string; language: string; status: string; category?: string; rejected_reason?: string; components?: { type: string; text?: string }[] }[];
  }>(config, {
    metodo: "GET",
    ruta: `${cuentaId}/message_templates`,
    query: { fields: "name,language,status,category,rejected_reason,components", limit: "200" },
    queHacia: "la consulta de plantillas",
  });
  return (r.data ?? [])
    .filter((t) => nombres.includes(t.name))
    .map((t) => ({
      nombre: t.name,
      idioma: t.language,
      estado: t.status,
      categoria: t.category ?? null,
      cuerpo: t.components?.find((c) => c.type === "BODY")?.text ?? null,
      motivoRechazo: t.rejected_reason && t.rejected_reason !== "NONE" ? t.rejected_reason : null,
    }));
}

/**
 * Da de alta una plantilla y la manda a revisión de Meta. Meta puede cambiarle
 * la categoría (por ejemplo, de UTILITY a MARKETING): se regresa la que quedó.
 */
export async function crearPlantilla(
  config: WhatsAppConfig,
  cuentaId: string,
  p: { nombre: string; idioma: string; categoria: string; cuerpo: string; ejemplo: string[] },
): Promise<{ id: string; estado: string; categoria: string | null }> {
  const r = await llamarMeta<{ id?: string; status?: string; category?: string }>(config, {
    metodo: "POST",
    ruta: `${cuentaId}/message_templates`,
    queHacia: `la plantilla ${p.nombre}`,
    body: {
      name: p.nombre,
      language: p.idioma,
      category: p.categoria,
      components: [{ type: "BODY", text: p.cuerpo, example: { body_text: [p.ejemplo] } }],
    },
  });
  if (!r.id) throw new WhatsAppError(`Meta no regresó el ID de la plantilla ${p.nombre}`, null, {});
  return { id: r.id, estado: r.status ?? "PENDING", categoria: r.category ?? null };
}
