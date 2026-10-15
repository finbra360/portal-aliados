"use server";

import { revalidatePath } from "next/cache";
import { getAdminSession } from "@/lib/get-admin-session";
import { COBRANZA_ROLES, requireRole } from "@/lib/rbac";
import { codigoDeError } from "@/lib/collections/errors";
import { ChatError, responder, retomar, setBaja } from "@/lib/db/whatsapp-chat";

export type ChatActionResult = { ok: true } | { ok: false; error: string };

// Todos los de cobranza (Super Admin y Finanzas) pueden responder.
async function run(fn: (actor: string) => Promise<unknown>): Promise<ChatActionResult> {
  const admin = requireRole(await getAdminSession(), COBRANZA_ROLES);
  try {
    await fn(admin.email);
  } catch (e) {
    if (e instanceof ChatError) return { ok: false, error: e.message };
    const c = codigoDeError("chat", e);
    return { ok: false, error: `No se pudo enviar. Intenta de nuevo. (código ${c})` };
  }
  revalidatePath("/backoffice/cobranza/chat");
  return { ok: true };
}

const telefonoValido = (t: string) => /^\d{10,15}$/.test(t);

export async function responderAction(telefono: string, _prev: ChatActionResult | null, fd: FormData): Promise<ChatActionResult> {
  if (!telefonoValido(telefono)) return { ok: false, error: "Teléfono no válido" };
  return run((actor) => responder({ telefono, texto: String(fd.get("texto") ?? ""), actor }));
}

export async function retomarAction(telefono: string): Promise<ChatActionResult> {
  if (!telefonoValido(telefono)) return { ok: false, error: "Teléfono no válido" };
  return run((actor) => retomar({ telefono, actor }));
}

export async function setBajaAction(telefono: string, baja: boolean): Promise<ChatActionResult> {
  if (!telefonoValido(telefono)) return { ok: false, error: "Teléfono no válido" };
  return run((actor) => setBaja({ telefono, baja, actor }));
}
