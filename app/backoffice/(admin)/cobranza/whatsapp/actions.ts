"use server";

import { revalidatePath } from "next/cache";
import { getAdminSession } from "@/lib/get-admin-session";
import { requireRole } from "@/lib/rbac";
import { codigoDeError } from "@/lib/collections/errors";
import { WhatsAppError } from "@/lib/whatsapp/client";
import { WhatsAppMoraError, crearPlantillasEnMeta, enviarPrueba, revisarConMeta, runMoraReminders, setEnvioMoraActivo, setPlantillaActiva } from "@/lib/db/whatsapp-mora";

export type WhatsAppActionResult = { ok: true; mensaje?: string } | { ok: false; error: string };

// Prender el envío, activar plantillas y mandar a mano le escriben a
// clientes reales: solo Super Admin.
async function run(fn: (actor: string) => Promise<string | void>): Promise<WhatsAppActionResult> {
  const admin = requireRole(await getAdminSession(), ["super_admin"]);
  let mensaje: string | void;
  try {
    mensaje = await fn(admin.email);
  } catch (e) {
    if (e instanceof WhatsAppMoraError || e instanceof WhatsAppError) return { ok: false, error: e.message };
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

export async function revisarConMetaAction(): Promise<WhatsAppActionResult> {
  return run(async (actor) => {
    const r = await revisarConMeta({ actor });
    const n = r.numero;
    const calidad: Record<string, string> = { GREEN: "alta", YELLOW: "media", RED: "baja", UNKNOWN: "sin calificar" };
    const base = `Conexión correcta: ${n.nombreVerificado ?? "número"} ${n.numero ?? ""}${n.calidad ? `, calidad ${calidad[n.calidad] ?? n.calidad}` : ""}.`;
    return r.avisos.length ? `${base} ${r.avisos.join(" ")}` : `${base} Plantillas actualizadas.`;
  });
}

export async function enviarPruebaAction(_prev: WhatsAppActionResult | null, fd: FormData): Promise<WhatsAppActionResult> {
  return run(async (actor) => {
    const r = await enviarPrueba({ telefono: String(fd.get("telefono") ?? ""), plantillaId: Number(fd.get("plantillaId")), actor });
    return r.texto ? `Enviado. Debe llegarte: "${r.texto}"` : "Enviado.";
  });
}

export async function crearPlantillasAction(): Promise<WhatsAppActionResult> {
  return run(async (actor) => {
    const r = await crearPlantillasEnMeta({ actor });
    const partes = [
      r.creadas.length ? `Enviadas a revisión de Meta: ${r.creadas.join(", ")}.` : "No se creó ninguna plantilla nueva.",
      r.yaExistian.length ? `Ya existían: ${r.yaExistian.join(", ")}.` : "",
      ...r.avisos,
    ];
    return partes.filter(Boolean).join(" ");
  });
}
