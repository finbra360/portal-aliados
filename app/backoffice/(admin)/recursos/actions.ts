"use server";

import { revalidatePath } from "next/cache";
import { getAdminSession } from "@/lib/get-admin-session";
import { requireRole } from "@/lib/rbac";
import { createResource, setResourceStatus, type ResourceStatus } from "@/lib/db/resources";

export async function createResourceAction(formData: FormData) {
  const session = await getAdminSession();
  const admin = requireRole(session, ["super_admin", "comercial"]);

  const titulo = String(formData.get("titulo") ?? "").trim();
  const tipo = String(formData.get("tipo") ?? "").trim();
  const categoria = String(formData.get("categoria") ?? "").trim();
  const url = String(formData.get("url") ?? "").trim();
  const contenido = String(formData.get("contenido") ?? "").trim();

  if (!titulo || !tipo || !categoria) {
    return;
  }

  await createResource({ titulo, tipo, categoria, url: url || undefined, contenido: contenido || undefined, actorEmail: admin.email });
  revalidatePath("/backoffice/recursos");
}

export async function setResourceStatusAction(id: number, estatus: ResourceStatus) {
  const session = await getAdminSession();
  const admin = requireRole(session, ["super_admin", "comercial"]);
  await setResourceStatus({ id, estatus, actorEmail: admin.email });
  revalidatePath("/backoffice/recursos");
}
