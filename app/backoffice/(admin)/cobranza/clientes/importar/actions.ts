"use server";

import { revalidatePath } from "next/cache";
import { getAdminSession } from "@/lib/get-admin-session";
import { requierePermiso } from "@/lib/permisos";
import { codigoDeError } from "@/lib/collections/errors";
import { ContactError, importarContactos, previsualizarContactos } from "@/lib/db/collection-clients";
import { MAX_FILAS_CONTACTOS, type FilaContacto } from "@/lib/collections/contacts-import";

const MAX_TEXTO = MAX_FILAS_CONTACTOS * 400;

export async function previsualizarContactosAction(texto: string): Promise<{ ok: true; filas: FilaContacto[] } | { ok: false; error: string }> {
  requierePermiso(await getAdminSession(), "cobranza.operar");
  if (texto.length > MAX_TEXTO) return { ok: false, error: "El archivo es demasiado grande" };
  try {
    const r = await previsualizarContactos(texto);
    return "error" in r ? { ok: false, error: r.error } : { ok: true, filas: r.filas };
  } catch (e) {
    const c = codigoDeError("carga de contactos", e);
    return { ok: false, error: `No pudimos revisar el archivo. Intenta de nuevo. (código ${c})` };
  }
}

export async function importarContactosAction(texto: string): Promise<{ ok: true; mensaje: string } | { ok: false; error: string }> {
  const admin = requierePermiso(await getAdminSession(), "cobranza.operar");
  if (texto.length > MAX_TEXTO) return { ok: false, error: "El archivo es demasiado grande" };
  let r: Awaited<ReturnType<typeof importarContactos>>;
  try {
    r = await importarContactos(texto, admin.email);
  } catch (e) {
    if (e instanceof ContactError) return { ok: false, error: e.message };
    const c = codigoDeError("carga de contactos", e);
    return { ok: false, error: `No pudimos guardar los contactos. Intenta de nuevo. (código ${c})` };
  }
  revalidatePath("/backoffice/cobranza/clientes", "layout");
  revalidatePath("/backoffice/cobranza/cola");
  const partes = [
    r.creados === 1 ? "Se dio de alta 1 contacto" : `Se dieron de alta ${r.creados} contactos`,
    r.recordatorios ? (r.recordatorios === 1 ? "1 ya recibe los recordatorios" : `${r.recordatorios} ya reciben los recordatorios`) : null,
    r.existentes ? (r.existentes === 1 ? "1 ya existía" : `${r.existentes} ya existían`) : null,
    r.errores ? (r.errores === 1 ? "1 con error se omitió" : `${r.errores} con error se omitieron`) : null,
  ].filter(Boolean);
  return { ok: true, mensaje: partes.join(" · ") + "." };
}
