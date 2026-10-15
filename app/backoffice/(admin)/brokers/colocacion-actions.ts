"use server";

import { revalidatePath } from "next/cache";
import { getAdminSession } from "@/lib/get-admin-session";
import { requireRole } from "@/lib/rbac";
import { codigoDeError } from "@/lib/collections/errors";
import {
  ColocacionError,
  crearColocacion,
  editarColocacion,
  eliminarColocacion,
  importarColocacion,
  previsualizarColocacion,
} from "@/lib/db/colocacion";
import type { FilaColocacion } from "@/lib/brokers/colocacion";
import { COLOCACION_EDITAN } from "./roles";

export type ColocacionActionResult = { ok: true; mensaje?: string } | { ok: false; error: string };

async function run(fn: (actor: string) => Promise<string | void>): Promise<ColocacionActionResult> {
  const admin = requireRole(await getAdminSession(), COLOCACION_EDITAN);
  let mensaje: string | void;
  try {
    mensaje = await fn(admin.email);
  } catch (e) {
    if (e instanceof ColocacionError) return { ok: false, error: e.message };
    const c = codigoDeError("colocación", e);
    return { ok: false, error: `No pudimos guardar el cambio. Intenta de nuevo. (código ${c})` };
  }
  // La colocación se ve en el perfil, la lista, rankings, comisiones y el portal.
  revalidatePath("/", "layout");
  return { ok: true, mensaje: mensaje || undefined };
}

const texto = (v: FormDataEntryValue | null) => String(v ?? "");
const captura = (brokerId: string, fd: FormData) => ({
  brokerId,
  fecha: texto(fd.get("fecha")),
  monto: texto(fd.get("monto")),
  comisionAperturaPct: texto(fd.get("comisionAperturaPct")),
  pagadoTotalidad: fd.get("pagadoTotalidad") ? "si" : "no",
  referencia: texto(fd.get("referencia")),
});

export async function crearColocacionAction(brokerId: string, _prev: ColocacionActionResult | null, fd: FormData): Promise<ColocacionActionResult> {
  return run(async (actor) => {
    await crearColocacion({ ...captura(brokerId, fd), actor });
    return "Operación agregada.";
  });
}

export async function editarColocacionAction(brokerId: string, id: number, _prev: ColocacionActionResult | null, fd: FormData): Promise<ColocacionActionResult> {
  return run(async (actor) => {
    await editarColocacion({ ...captura(brokerId, fd), id, actor });
    return "Cambios guardados.";
  });
}

export async function eliminarColocacionAction(brokerId: string, id: number): Promise<ColocacionActionResult> {
  return run(async (actor) => {
    await eliminarColocacion({ id, brokerId, actor });
    return "Operación eliminada.";
  });
}

export type VistaPreviaColocacion = { ok: true; filas: FilaColocacion[] } | { ok: false; error: string };

export async function previsualizarColocacionAction(contenido: string): Promise<VistaPreviaColocacion> {
  requireRole(await getAdminSession(), COLOCACION_EDITAN);
  try {
    const r = await previsualizarColocacion(contenido);
    return "error" in r ? { ok: false, error: r.error } : { ok: true, filas: r.filas };
  } catch (e) {
    const c = codigoDeError("colocación: vista previa", e);
    return { ok: false, error: `No pudimos revisar el archivo. Intenta de nuevo. (código ${c})` };
  }
}

export async function importarColocacionAction(contenido: string): Promise<ColocacionActionResult> {
  return run(async (actor) => {
    const r = await importarColocacion(contenido, actor);
    const peso = r.monto.toLocaleString("es-MX", { style: "currency", currency: "MXN" });
    const partes = [r.creadas === 1 ? `Se guardó 1 operación (${peso})` : `Se guardaron ${r.creadas} operaciones (${peso})`];
    if (r.existentes) partes.push(r.existentes === 1 ? "1 ya estaba guardada" : `${r.existentes} ya estaban guardadas`);
    if (r.errores) partes.push(r.errores === 1 ? "1 con error se omitió" : `${r.errores} con error se omitieron`);
    return `${partes.join("; ")}.`;
  });
}
