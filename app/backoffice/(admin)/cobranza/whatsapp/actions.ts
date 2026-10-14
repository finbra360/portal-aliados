"use server";

import { revalidatePath } from "next/cache";
import { getAdminSession } from "@/lib/get-admin-session";
import { requireRole } from "@/lib/rbac";
import { codigoDeError } from "@/lib/collections/errors";
import { WhatsAppMoraError, runMoraReminders, setEnvioMoraActivo, setPlantillaActiva } from "@/lib/db/whatsapp-mora";

export type WhatsAppActionResult = { ok: true; mensaje?: string } | { ok: false; error: string };

// Prender el envío, activar plantillas y mandar a mano le escriben a
// clientes reales: solo Super Admin.
async function run(fn: (actor: string) => Promise<string | void>): Promise<WhatsAppActionResult> {
  const admin = requireRole(await getAdminSession(), ["super_admin"]);
  let mensaje: string | void;
  try {
    mensaje = await fn(admin.email);
  } catch (e) {
    if (e instanceof WhatsAppMoraError) return { ok: false, error: e.message };
    const c = codigoDeError("whatsapp", e);
    return { ok: false, error: `No pudimos completar la acción. (código ${c})` };
  }
  revalidatePath("/backoffice/cobranza/whatsapp");
  return { ok: true, mensaje: mensaje || undefined };
}

export async function setEnvioActivoAction(activo: boolean): Promise<WhatsAppActionResult> {
  return run((actor) => setEnvioMoraActivo({ activo, actor }));
}

export async function setPlantillaActivaAction(id: number, activa: boolean): Promise<WhatsAppActionResult> {
  return run((actor) => setPlantillaActiva({ id, activa, actor }));
}

export async function enviarAhoraAction(): Promise<WhatsAppActionResult> {
  return run(async (actor) => {
    const r = await runMoraReminders({ disparadoPor: actor, manual: true });
    if (r.bloqueos.length) throw new WhatsAppMoraError(`No se envió nada: ${r.bloqueos.join("; ")}`);
    const n = (k: number, uno: string, varios: string) => `${k} ${k === 1 ? uno : varios}`;
    return `${n(r.enviados, "enviado", "enviados")}, ${n(r.fallidos, "fallido", "fallidos")}, ${n(r.omitidos, "sin enviar", "sin enviar")}.${r.detenido ? ` ${r.detenido}` : ""}`;
  });
}
