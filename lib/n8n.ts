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
  fecha: string;
  monto: number;
  /** % de comisión de apertura pactado con el cliente. undefined si no se ha capturado en el Sheet. */
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

export interface Recurso {
  titulo: string;
  tipo: string;
  url: string;
  categoria: string;
}

export interface RecursosResponse {
  recursos: Recurso[];
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

/**
 * No implementado todavía — no existe backend de concursos. El tipo queda
 * definido para que activar un concurso futuro solo requiera el webhook.
 */
export interface Contest {
  id: string;
  nombre: string;
  periodoInicio: string;
  periodoFin: string;
  criterio: LeaderboardCriterio | "puntos";
  premio: string;
  standings: LeaderboardEntry[];
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

export function getStats(brokerId: string) {
  return callWebhook<BrokerStats>("/webhook/broker-portal-stats", {
    body: { brokerId },
  });
}

export function getRecursos() {
  return callWebhook<RecursosResponse>("/webhook/broker-portal-recursos", {
    method: "GET",
  });
}

export function getLeaderboard() {
  return callWebhook<LeaderboardResponse>("/webhook/broker-portal-leaderboard", {
    method: "GET",
  });
}
