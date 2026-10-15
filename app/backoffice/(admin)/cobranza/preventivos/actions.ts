"use server";

import { revalidatePath } from "next/cache";
import { getAdminSession } from "@/lib/get-admin-session";
import { requireRole } from "@/lib/rbac";
import { codigoDeError } from "@/lib/collections/errors";
import { runPreventivos, setEnvioPreventivoActivo } from "@/lib/db/whatsapp-preventivo";
import type { WhatsAppActionResult } from "../whatsapp/actions";

// Prender el envío o mandar a mano le escribe a clientes reales: solo Super Admin.
async function run(fn: (actor: string) => Promise<string | void>): Promise<WhatsAppActionResult> {
  const admin = requireRole(await getAdminSession(), ["super_admin"]);
  let mensaje: string | void;
  try {
    mensaje = await fn(admin.email);
  } catch (e) {
    const c = codigoDeError("preventivos", e);
    return { ok: false, error: `No pudimos completar la acción. (código ${c})` };
  }
  revalidatePath("/backoffice/cobranza/preventivos");
  return { ok: true, mensaje: mensaje || undefined };
}

export async function setPreventivoActivoAction(activo: boolean): Promise<WhatsAppActionResult> {
  return run((actor) => setEnvioPreventivoActivo({ activo, actor }));
}

export async function enviarPreventivosAhoraAction(): Promise<WhatsAppActionResult> {
  return run(async (actor) => {
    const r = await runPreventivos({ disparadoPor: actor, manual: true });
    if (r.bloqueos.length) return `No se envió nada: ${r.bloqueos.join("; ")}`;
    const n = (k: number, uno: string, varios: string) => `${k} ${k === 1 ? uno : varios}`;
    return `${n(r.enviados, "enviado", "enviados")}, ${n(r.fallidos, "fallido", "fallidos")}, ${r.omitidos} sin enviar.${r.detenido ? ` ${r.detenido}` : ""}`;
  });
}
