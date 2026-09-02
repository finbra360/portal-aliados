"use server";

import { revalidatePath } from "next/cache";
import { getAdminSession } from "@/lib/get-admin-session";
import { requireRole } from "@/lib/rbac";
import { createContest, setContestStatus, type ContestStatus } from "@/lib/db/contests";
import type { LeaderboardCriterio } from "@/lib/n8n";

export async function createContestAction(formData: FormData) {
  const session = await getAdminSession();
  const admin = requireRole(session, ["super_admin", "comercial"]);

  const nombre = String(formData.get("nombre") ?? "").trim();
  const descripcion = String(formData.get("descripcion") ?? "").trim();
  const fechaInicio = String(formData.get("fechaInicio") ?? "");
  const fechaFin = String(formData.get("fechaFin") ?? "");
  const criterio = String(formData.get("criterio") ?? "monto") as LeaderboardCriterio;
  const premio = String(formData.get("premio") ?? "").trim();
  const numGanadores = Number(formData.get("numGanadores") ?? 1);

  if (!nombre || !fechaInicio || !fechaFin || !premio) {
    return;
  }

  await createContest({
    nombre,
    descripcion: descripcion || undefined,
    fechaInicio,
    fechaFin,
    criterio,
    premio,
    numGanadores,
    actorEmail: admin.email,
  });
  revalidatePath("/backoffice/concursos");
}

export async function setContestStatusAction(id: number, estatus: ContestStatus) {
  const session = await getAdminSession();
  const admin = requireRole(session, ["super_admin", "comercial"]);
  await setContestStatus({ id, estatus, actorEmail: admin.email });
  revalidatePath("/backoffice/concursos");
}
