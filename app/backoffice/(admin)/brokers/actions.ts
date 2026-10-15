"use server";

import { revalidatePath } from "next/cache";
import { getAdminSession } from "@/lib/get-admin-session";
import { requireRole } from "@/lib/rbac";
import { codigoDeError } from "@/lib/collections/errors";
import { setBrokerStatus, type BrokerEstatus } from "@/lib/db/broker-status";
import { BrokerError, crearBroker, editarBroker, importarBrokers, previsualizarImportacion } from "@/lib/db/brokers";
import type { FilaImportacion } from "@/lib/brokers/importar";
import { BROKERS_EDITAN } from "./roles";

export async function updateBrokerStatusAction(brokerId: string, estatus: BrokerEstatus) {
  const session = await getAdminSession();
  const admin = requireRole(session, BROKERS_EDITAN);
  await setBrokerStatus({ brokerId, estatus, actorEmail: admin.email });
  revalidatePath(`/backoffice/brokers/${brokerId}`);
  revalidatePath("/backoffice/brokers");
}

export type BrokerActionResult = { ok: true; mensaje?: string; id?: string } | { ok: false; error: string };

async function run(fn: (actor: string) => Promise<{ mensaje?: string; id?: string } | void>): Promise<BrokerActionResult> {
  const admin = requireRole(await getAdminSession(), BROKERS_EDITAN);
  let r: { mensaje?: string; id?: string } | void;
  try {
    r = await fn(admin.email);
  } catch (e) {
    if (e instanceof BrokerError) return { ok: false, error: e.message };
    const c = codigoDeError("brokers", e);
    return { ok: false, error: `No pudimos guardar el cambio. Intenta de nuevo. (código ${c})` };
  }
  revalidatePath("/backoffice/brokers", "layout");
  return { ok: true, ...(r || {}) };
}

const texto = (v: FormDataEntryValue | null) => String(v ?? "");

export async function crearBrokerAction(_prev: BrokerActionResult | null, fd: FormData): Promise<BrokerActionResult> {
  return run(async (actor) => {
    const id = await crearBroker({ email: texto(fd.get("email")), nombre: texto(fd.get("nombre")), telefono: texto(fd.get("telefono")), id: texto(fd.get("id")), actor });
    return { id, mensaje: `Broker dado de alta como ${id}.` };
  });
}

export async function editarBrokerAction(id: string, _prev: BrokerActionResult | null, fd: FormData): Promise<BrokerActionResult> {
  return run(async (actor) => {
    await editarBroker({ id, email: texto(fd.get("email")), nombre: texto(fd.get("nombre")), telefono: texto(fd.get("telefono")), actor });
    return { mensaje: "Cambios guardados." };
  });
}

export type VistaPreviaResult = { ok: true; filas: FilaImportacion[] } | { ok: false; error: string };

export async function previsualizarImportacionAction(contenido: string): Promise<VistaPreviaResult> {
  requireRole(await getAdminSession(), BROKERS_EDITAN);
  try {
    const r = await previsualizarImportacion(contenido);
    return "error" in r ? { ok: false, error: r.error } : { ok: true, filas: r.filas };
  } catch (e) {
    const c = codigoDeError("brokers: vista previa", e);
    return { ok: false, error: `No pudimos revisar el archivo. Intenta de nuevo. (código ${c})` };
  }
}

export async function importarBrokersAction(contenido: string): Promise<BrokerActionResult> {
  return run(async (actor) => {
    const r = await importarBrokers(contenido, actor);
    const partes = [r.creados.length === 1 ? "Se dio de alta 1 broker" : `Se dieron de alta ${r.creados.length} brokers`];
    if (r.existentes) partes.push(r.existentes === 1 ? "1 ya existía" : `${r.existentes} ya existían`);
    if (r.errores) partes.push(r.errores === 1 ? "1 con error se omitió" : `${r.errores} con error se omitieron`);
    return { mensaje: `${partes.join("; ")}.` };
  });
}
