"use server";

import { revalidatePath } from "next/cache";
import { getAdminSession } from "@/lib/get-admin-session";
import { requireRole } from "@/lib/rbac";
import { redirect } from "next/navigation";
import { requierePermiso } from "@/lib/permisos";
import { NegocioError } from "@/lib/db/negocios";
import { crearNegocioDesdeLead } from "@/lib/db/negocios-origenes";
import {
  updateLeadEstatusComercial,
  resolveHitlReview,
  resolverDedupHitl,
  type LeadEstatusComercial,
} from "@/lib/db/leads";

export async function updateLeadEstatusAction(id: string, estatus: LeadEstatusComercial) {
  const session = await getAdminSession();
  const admin = requireRole(session, ["super_admin", "comercial"]);
  await updateLeadEstatusComercial({ id, estatus, actorEmail: admin.email });
  revalidatePath("/backoffice/leads");
}

export async function resolveHitlReviewAction(formData: FormData) {
  const session = await getAdminSession();
  const admin = requireRole(session, ["super_admin", "comercial"]);

  const id = Number(formData.get("id") ?? 0);
  const resolutionNotes = String(formData.get("resolutionNotes") ?? "").trim();
  if (!id || !resolutionNotes) {
    return;
  }

  await resolveHitlReview({ id, resolutionNotes, actorEmail: admin.email });
  revalidatePath("/backoffice/leads");
}

export async function resolverDedupAction(formData: FormData) {
  const session = await getAdminSession();
  const admin = requireRole(session, ["super_admin", "comercial"]);

  const id = Number(formData.get("id") ?? 0);
  const decision = String(formData.get("decision") ?? "");
  if (!id || (decision !== "misma" && decision !== "distintas")) {
    return;
  }
  const nota = String(formData.get("nota") ?? "").trim() || null;

  await resolverDedupHitl({ id, decision, actorEmail: admin.email, nota });
  revalidatePath("/backoffice/leads");
}

/** Crea el negocio de crédito de un lead (o lleva al que ya tiene). */
export async function crearNegocioDesdeLeadAction(formData: FormData) {
  const session = await getAdminSession();
  requireRole(session, ["super_admin", "comercial"]);
  const admin = requierePermiso(session, "originacion.operar");
  const leadId = String(formData.get("leadId") ?? "");
  let id: string;
  try {
    id = await crearNegocioDesdeLead(leadId, admin.email);
  } catch (e) {
    if (e instanceof NegocioError) redirect(`/backoffice/leads?error=${encodeURIComponent(e.message)}`);
    throw e;
  }
  revalidatePath("/backoffice/leads", "layout");
  revalidatePath("/backoffice/negocios", "layout");
  redirect(`/backoffice/negocios/${id}`);
}
