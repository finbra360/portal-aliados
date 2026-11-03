"use server";

import { revalidatePath } from "next/cache";
import { getAdminSession } from "@/lib/get-admin-session";
import { requireRole } from "@/lib/rbac";
import { marcarConversacionAtendida } from "@/lib/db/prospeccion";

export async function marcarAtendidaAction(formData: FormData) {
  const session = await getAdminSession();
  const admin = requireRole(session, ["super_admin", "comercial"]);

  const companyId = String(formData.get("companyId") ?? "").trim();
  if (!companyId) {
    return;
  }
  const nota = String(formData.get("nota") ?? "").trim() || null;

  await marcarConversacionAtendida({ companyId, actorEmail: admin.email, nota });
  revalidatePath("/backoffice/leads/conversaciones");
}
