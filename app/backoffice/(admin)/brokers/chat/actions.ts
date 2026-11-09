"use server";

import { revalidatePath } from "next/cache";
import { getAdminSession } from "@/lib/get-admin-session";
import { requireRole } from "@/lib/rbac";
import { codigoDeError } from "@/lib/collections/errors";
import { ChatAliadosError, marcarLeidoAliado, responderAliado } from "@/lib/db/aliados-chat";
import { BROKERS_EDITAN } from "../roles";

export type ChatAliadosResult = { ok: true } | { ok: false; error: string };

const telefonoValido = (t: string) => /^\d{10,15}$/.test(t);

export async function responderAliadoAction(telefono: string, texto: string): Promise<ChatAliadosResult> {
  const admin = requireRole(await getAdminSession(), BROKERS_EDITAN);
  if (!telefonoValido(telefono)) return { ok: false, error: "Teléfono no válido" };
  try {
    await responderAliado({ telefono, texto, actor: admin.email });
  } catch (e) {
    if (e instanceof ChatAliadosError) return { ok: false, error: e.message };
    const c = codigoDeError("chat aliados", e);
    return { ok: false, error: `No pudimos mandar el mensaje. (código ${c})` };
  }
  revalidatePath("/backoffice/brokers/chat");
  return { ok: true };
}

export async function marcarLeidoAliadoAction(telefono: string): Promise<ChatAliadosResult> {
  const admin = requireRole(await getAdminSession(), BROKERS_EDITAN);
  if (!telefonoValido(telefono)) return { ok: false, error: "Teléfono no válido" };
  await marcarLeidoAliado({ telefono, actor: admin.email });
  revalidatePath("/backoffice/brokers/chat");
  return { ok: true };
}
