"use server";

import { revalidatePath } from "next/cache";
import { getAdminSession } from "@/lib/get-admin-session";
import { COBRANZA_ROLES, requireRole } from "@/lib/rbac";
import {
  ContactError,
  addManualContact,
  setContactEstatus,
  setContactTipo,
  setContactoCobranza,
} from "@/lib/db/collection-clients";
import { TIPOS_CONTACTO, type TipoContacto } from "@/lib/collections/contacts";

export type ActionResult = { ok: true } | { ok: false; error: string };

async function run(clientId: string, fn: (actor: string) => Promise<unknown>): Promise<ActionResult> {
  const admin = requireRole(await getAdminSession(), COBRANZA_ROLES);
  try {
    await fn(admin.email);
  } catch (e) {
    if (e instanceof ContactError) return { ok: false, error: e.message };
    console.error("Error en acción de contactos:", e);
    return { ok: false, error: "No pudimos guardar el cambio. Intenta de nuevo." };
  }
  revalidatePath(`/backoffice/cobranza/clientes/${clientId}`);
  revalidatePath("/backoffice/cobranza/cola");
  return { ok: true };
}

const esTipo = (t: string): t is TipoContacto => t in TIPOS_CONTACTO;

export async function setRecipientAction(clientId: string, contactId: string | null): Promise<ActionResult> {
  return run(clientId, (actor) => setContactoCobranza({ clientId, contactId, actor }));
}

export async function setTipoAction(clientId: string, contactId: string, tipo: string): Promise<ActionResult> {
  if (!esTipo(tipo)) return { ok: false, error: "Tipo de contacto no válido" };
  return run(clientId, (actor) => setContactTipo({ contactId, tipo, actor }));
}

export async function setEstatusAction(clientId: string, contactId: string, estatus: string): Promise<ActionResult> {
  if (estatus !== "activo" && estatus !== "invalido" && estatus !== "baja") return { ok: false, error: "Estado no válido" };
  return run(clientId, (actor) => setContactEstatus({ contactId, estatus, actor }));
}

export async function addContactAction(clientId: string, _prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const tipo = String(formData.get("tipo") ?? "telefono") === "email" ? "email" : "telefono";
  const tipoContacto = String(formData.get("tipoContacto") ?? "");
  if (!esTipo(tipoContacto)) return { ok: false, error: "Elige el tipo de contacto" };
  return run(clientId, (actor) =>
    addManualContact({
      clientId,
      tipo,
      valor: String(formData.get("valor") ?? ""),
      nombre: String(formData.get("nombre") ?? "") || null,
      tipoContacto,
      notas: String(formData.get("notas") ?? "") || null,
      usarParaRecordatorios: formData.get("usarParaRecordatorios") === "on",
      actor,
    }),
  );
}
