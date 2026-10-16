"use server";

import { revalidatePath } from "next/cache";
import { getAdminSession } from "@/lib/get-admin-session";
import { requireRole } from "@/lib/rbac";
import { createOperation, setOperationBrokerMessage, updateOperationStage } from "@/lib/db/operations";
import type { OperationStatus } from "@/components/ui/StatusPill";

export async function createOperationAction(formData: FormData) {
  const session = await getAdminSession();
  const admin = requireRole(session, ["super_admin", "comercial"]);

  const brokerId = String(formData.get("brokerId") ?? "").trim();
  const clienteReferencia = String(formData.get("clienteReferencia") ?? "").trim();
  const montoSolicitado = Number(formData.get("montoSolicitado") ?? 0);

  if (!brokerId || !clienteReferencia || !montoSolicitado) {
    return;
  }

  await createOperation({ brokerId, clienteReferencia, montoSolicitado, actorEmail: admin.email });
  revalidatePath("/backoffice/operaciones");
}

export async function updateOperationStageAction(id: number, etapa: OperationStatus) {
  const session = await getAdminSession();
  const admin = requireRole(session, ["super_admin", "comercial"]);
  await updateOperationStage({ id, etapa, actorEmail: admin.email });
  revalidatePath("/backoffice/operaciones");
  revalidatePath(`/operaciones/${id}`);
}

export async function setOperationMessageAction(id: number, formData: FormData) {
  const session = await getAdminSession();
  const admin = requireRole(session, ["super_admin", "comercial"]);
  const mensaje = String(formData.get("mensaje") ?? "").trim().slice(0, 500);
  await setOperationBrokerMessage({ id, mensaje: mensaje || null, actorEmail: admin.email });
  revalidatePath("/backoffice/operaciones");
  revalidatePath(`/operaciones/${id}`);
}
