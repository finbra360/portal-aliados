import type { AdminSessionPayload } from "../admin-auth";
import { chSql } from "./db";
import type { PoliticaCH } from "./politica-tipos";

export interface VersionPolitica {
  id: number;
  version: number;
  label: string;
  status: "draft" | "active" | "archived";
  notes: string | null;
  createdBy: string;
  createdAt: Date;
  activatedBy: string | null;
  activatedAt: Date | null;
}

export async function listarVersiones(): Promise<VersionPolitica[]> {
  const rows = await chSql()`
    select id, version, label, status, notes, created_by, created_at, activated_by, activated_at
    from policy_versions order by version desc`;
  return rows.map((r) => ({
    id: r.id,
    version: r.version,
    label: r.label,
    status: r.status,
    notes: r.notes,
    createdBy: r.created_by,
    createdAt: r.created_at,
    activatedBy: r.activated_by,
    activatedAt: r.activated_at,
  }));
}

export async function politicaActiva(): Promise<{ id: number; version: number; label: string; config: PoliticaCH } | null> {
  const [r] = await chSql()`select id, version, label, config from policy_versions where status = 'active' limit 1`;
  return r ? { id: r.id, version: r.version, label: r.label, config: r.config as PoliticaCH } : null;
}

export type ResultadoComando = { ok: true; version: number } | { ok: false; error: string; issues?: string[] };

/**
 * Los cambios de política pasan por la API interna de Credit Health, que valida la
 * política con el mismo esquema del motor y maneja el versionado.
 */
async function enviar(cuerpo: Record<string, unknown>): Promise<ResultadoComando> {
  const base = process.env.CREDIT_HEALTH_API_URL;
  const token = process.env.CREDIT_HEALTH_INTERNAL_TOKEN;
  if (!base || !token) return { ok: false, error: "Falta configurar CREDIT_HEALTH_API_URL o CREDIT_HEALTH_INTERNAL_TOKEN." };
  try {
    const res = await fetch(`${base.replace(/\/$/, "")}/api/internal/policies`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(cuerpo),
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
    const json = (await res.json().catch(() => ({}))) as { version?: number; error?: string; issues?: string[] };
    if (!res.ok || typeof json.version !== "number") return { ok: false, error: json.error ?? `Credit Health respondió ${res.status}`, issues: json.issues };
    return { ok: true, version: json.version };
  } catch {
    return { ok: false, error: "No pudimos conectar con Credit Health. Intenta de nuevo." };
  }
}

export function guardarBorrador(config: PoliticaCH, notas: string | null, admin: AdminSessionPayload) {
  return enviar({ action: "draft", config, notes: notas, actor: { email: admin.email, role: admin.role } });
}

export function activarVersion(id: number, admin: AdminSessionPayload) {
  return enviar({ action: "activate", id, actor: { email: admin.email, role: admin.role } });
}
