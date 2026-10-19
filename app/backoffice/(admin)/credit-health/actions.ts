"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getAdminSession } from "@/lib/get-admin-session";
import { requireRole } from "@/lib/rbac";
import { CH_BORRAN, CH_EDITAN_POLITICAS, CH_OPERAN } from "@/lib/credit-health/roles";
import { ESTADOS_CONTACTO, type EstadoContacto } from "@/lib/credit-health/catalogo";
import { agregarNota, asignarProspecto, cambiarEstadoContacto, eliminarProspecto } from "@/lib/credit-health/prospectos";
import { activarVersion, guardarBorrador } from "@/lib/credit-health/politicas";
import type { PoliticaCH } from "@/lib/credit-health/politica-tipos";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ruta = (id: string) => `/backoffice/credit-health/prospectos/${id}`;

function idValido(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  if (!UUID.test(id)) throw new Error("Prospecto no válido");
  return id;
}

export async function cambiarEstadoAction(formData: FormData) {
  const admin = requireRole(await getAdminSession(), CH_OPERAN);
  const id = idValido(formData);
  const estado = String(formData.get("estado") ?? "");
  if (!(ESTADOS_CONTACTO as readonly string[]).includes(estado)) return;
  const nota = String(formData.get("nota") ?? "").trim().slice(0, 1000) || null;
  await cambiarEstadoContacto(id, estado as EstadoContacto, nota, admin);
  revalidatePath(ruta(id));
}

export async function agregarNotaAction(formData: FormData) {
  const admin = requireRole(await getAdminSession(), CH_OPERAN);
  const id = idValido(formData);
  const nota = String(formData.get("nota") ?? "").trim().slice(0, 2000);
  if (!nota) return;
  await agregarNota(id, nota, admin);
  revalidatePath(ruta(id));
}

export async function asignarAction(formData: FormData) {
  const admin = requireRole(await getAdminSession(), CH_OPERAN);
  const id = idValido(formData);
  const asignado = String(formData.get("asignado") ?? "").trim().slice(0, 160) || null;
  await asignarProspecto(id, asignado, admin);
  revalidatePath(ruta(id));
}

export async function eliminarAction(formData: FormData) {
  const admin = requireRole(await getAdminSession(), CH_BORRAN);
  const id = idValido(formData);
  const motivo = String(formData.get("motivo") ?? "").trim().slice(0, 300);
  if (motivo.length < 3) return;
  await eliminarProspecto(id, motivo, admin);
  redirect("/backoffice/credit-health/prospectos?aviso=eliminado");
}

export interface EstadoPolitica {
  ok: boolean;
  mensaje: string | null;
  detalles?: string[];
}

export async function guardarPoliticaAction(_prev: EstadoPolitica, formData: FormData): Promise<EstadoPolitica> {
  const admin = requireRole(await getAdminSession(), CH_EDITAN_POLITICAS);
  let config: PoliticaCH;
  try {
    config = JSON.parse(String(formData.get("config") ?? "{}"));
  } catch {
    return { ok: false, mensaje: "La política no tiene un formato válido." };
  }
  const notas = String(formData.get("notas") ?? "").trim().slice(0, 1000) || null;
  const res = await guardarBorrador(config, notas, admin);
  if (!res.ok) return { ok: false, mensaje: res.error, detalles: res.issues };
  revalidatePath("/backoffice/credit-health/politicas");
  return { ok: true, mensaje: `Borrador v${res.version} guardado. Revísalo y actívalo cuando el comité lo apruebe.` };
}

export async function activarPoliticaAction(formData: FormData) {
  const admin = requireRole(await getAdminSession(), CH_EDITAN_POLITICAS);
  const id = Number(formData.get("id"));
  if (!Number.isInteger(id) || id <= 0) return;
  const res = await activarVersion(id, admin);
  if (!res.ok) throw new Error(res.error);
  revalidatePath("/backoffice/credit-health/politicas");
}
