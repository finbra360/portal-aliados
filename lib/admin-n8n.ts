async function callWebhook<T>(path: string, body: unknown): Promise<T> {
  const baseUrl = process.env.N8N_BASE_URL;
  if (!baseUrl) {
    throw new Error("N8N_BASE_URL no está configurado");
  }

  const res = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });

  if (!res.ok) {
    throw new Error(`n8n webhook ${path} respondió ${res.status}`);
  }

  return res.json() as Promise<T>;
}

export interface AdminRequestCodeResponse {
  sent: boolean;
}

export interface AdminVerifyCodeResponse {
  valid: boolean;
  email?: string;
  nombre?: string;
  role?: "super_admin" | "comercial" | "finanzas";
}

export function requestAdminCode(email: string) {
  return callWebhook<AdminRequestCodeResponse>("/webhook/backoffice-request-code", { email });
}

export function verifyAdminCode(email: string, code: string) {
  return callWebhook<AdminVerifyCodeResponse>("/webhook/backoffice-verify-code", { email, code });
}
