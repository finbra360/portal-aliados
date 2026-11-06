async function callWebhook<T>(
  path: string,
  options: { method?: "GET" | "POST"; body?: unknown } = {},
): Promise<T> {
  const baseUrl = process.env.N8N_BASE_URL;
  if (!baseUrl) {
    throw new Error("N8N_BASE_URL no está configurado");
  }

  // Clave compartida con los webhooks del portal en n8n (credencial Header
  // Auth "x-finbra-portal"). Sin ella, n8n responde 403.
  const headers: Record<string, string> = {};
  if (options.body) headers["Content-Type"] = "application/json";
  if (process.env.N8N_PORTAL_SECRET) headers["x-finbra-portal"] = process.env.N8N_PORTAL_SECRET;

  const res = await fetch(`${baseUrl}${path}`, {
    method: options.method ?? "POST",
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
    cache: "no-store",
  });

  if (!res.ok) {
    throw new Error(`n8n webhook ${path} respondió ${res.status}`);
  }

  return res.json() as Promise<T>;
}

export interface RequestCodeResponse {
  sent: boolean;
}

/** Solo dice si el código es válido; quién es el broker sale de la tabla brokers. */
export interface VerifyCodeResponse {
  valid: boolean;
}

export interface PorMes {
  mes: string;
  anio: number;
  monto: number;
}

export interface OperacionFondeada {
  /** ID de la colocación en la base (broker_colocaciones). Identifica la operación, p. ej. para su pago de comisión. */
  id?: number;
  fecha: string;
  monto: number;
  /** % de comisión de apertura pactado con el cliente. undefined si no se ha capturado. */
  comisionAperturaPct?: number;
  /** true solo cuando el cliente ya terminó de pagar el crédito. */
  pagadoTotalidad: boolean;
}

export interface BrokerStats {
  totalHistorico: number;
  creditosCount: number;
  porMes: PorMes[];
  operaciones: OperacionFondeada[];
}

export type LeaderboardCriterio = "monto" | "operaciones";

export interface LeaderboardEntry {
  brokerId: string;
  nombre: string;
  totalColocado: number;
  numOperaciones: number;
  ticketPromedio: number;
}

export interface LeaderboardResponse {
  ranking: LeaderboardEntry[];
  criterioActual: LeaderboardCriterio;
}

/** Manda el código por correo. El portal ya validó que el broker existe y está activo. */
export function requestCode(email: string, nombre: string) {
  return callWebhook<RequestCodeResponse>("/webhook/broker-portal-request-code", {
    body: { email, nombre },
  });
}

export function verifyCode(email: string, code: string) {
  return callWebhook<VerifyCodeResponse>("/webhook/broker-portal-verify-code", {
    body: { email, code },
  });
}


/** Un correo de cobranza para que n8n lo mande con la cuenta de Gmail "Correo Cobranza". */
export interface CorreoCobranzaN8n {
  /** Id del registro en col_email_messages, para casar la respuesta. */
  id: string;
  to: string;
  subject: string;
  html: string;
}

export interface ResultadoCorreoN8n {
  id: string;
  ok: boolean;
  gmailId?: string | null;
  error?: string | null;
}

/** Manda un lote de correos de cobranza (flujo de n8n "Correos de cobranza (backoffice)"). Una llamada por lote. */
export async function enviarCorreosCobranza(correos: CorreoCobranzaN8n[]): Promise<ResultadoCorreoN8n[]> {
  const r = await callWebhook<{ resultados?: ResultadoCorreoN8n[] }>("/webhook/cobranza-correos", { body: { correos } });
  return Array.isArray(r.resultados) ? r.resultados : [];
}
