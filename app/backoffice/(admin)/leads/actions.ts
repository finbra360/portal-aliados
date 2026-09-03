"use server";

import { revalidatePath } from "next/cache";
import { getAdminSession } from "@/lib/get-admin-session";
import { requireRole } from "@/lib/rbac";
import { updateLeadEstatusComercial, resolveHitlReview, type LeadEstatusComercial } from "@/lib/db/leads";

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
