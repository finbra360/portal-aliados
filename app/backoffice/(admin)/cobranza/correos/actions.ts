"use server";

import { revalidatePath } from "next/cache";
import { getAdminSession } from "@/lib/get-admin-session";
import { requierePermiso } from "@/lib/permisos";
import { codigoDeError } from "@/lib/collections/errors";
import { CorreoCobranzaError, enviarCorreoPrueba, runCorreosMora, runCorreosPreventivos, setCorreoActivo, type CorreosRunResult } from "@/lib/db/correos-cobranza";

export type CorreoActionResult = { ok: true; mensaje?: string } | { ok: false; error: string };

const n = (k: number, uno: string, varios: string) => `${k} ${k === 1 ? uno : varios}`;
const resumen = (r: CorreosRunResult) =>
  r.bloqueos.length
    ? `No se envió nada: ${r.bloqueos.join("; ")}`
    : `${n(r.enviados, "enviado", "enviados")}, ${n(r.fallidos, "fallido", "fallidos")}, ${r.omitidos} sin enviar.${r.detenido ? ` ${r.detenido}` : ""}`;

// Prender el envío o mandar a mano le escribe a clientes reales: solo Super Admin.
async function run(fn: (actor: string) => Promise<string | void>): Promise<CorreoActionResult> {
  const admin = requierePermiso(await getAdminSession(), "cobranza.configurar");
  let mensaje: string | void;
  try {
    mensaje = await fn(admin.email);
  } catch (e) {
    if (e instanceof CorreoCobranzaError) return { ok: false, error: e.message };
    const c = codigoDeError("correos", e);
    return { ok: false, error: `No pudimos completar la acción. (código ${c})` };
  }
  revalidatePath("/backoffice/cobranza/correos");
  return { ok: true, mensaje: mensaje || undefined };
}

export async function setCorreoActivoAction(tipo: "mora" | "preventivo", activo: boolean): Promise<CorreoActionResult> {
  return run((actor) => setCorreoActivo({ tipo, activo, actor }));
}

export async function enviarCorreosAhoraAction(tipo: "mora" | "preventivo"): Promise<CorreoActionResult> {
  return run(async (actor) => resumen(await (tipo === "mora" ? runCorreosMora : runCorreosPreventivos)({ disparadoPor: actor, manual: true })));
}

/** Manda un correo de ejemplo a quien lo pide (a su propio correo). */
export async function enviarCorreoPruebaAction(): Promise<CorreoActionResult> {
  return run(async (actor) => {
    const r = await enviarCorreoPrueba({ para: actor, actor });
    if (r.enviados) return `Listo: revisa ${actor} (también la carpeta de spam).`;
    return `No salió: ${r.detenido ?? "n8n no confirmó el envío"}. Revisa "Últimos correos".`;
  });
}
