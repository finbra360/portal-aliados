"use server";

import { revalidatePath } from "next/cache";
import { getAdminSession } from "@/lib/get-admin-session";
import { requireRole } from "@/lib/rbac";
import { upsertCommissionPayment, setCommissionPaymentStatus, type CommissionPaymentStatus } from "@/lib/db/commission-payments";

export async function setCommissionStatusAction(
  brokerId: string,
  operacionFecha: string,
  operacionMonto: number,
  montoComision: number,
  estatus: CommissionPaymentStatus,
) {
  const session = await getAdminSession();
  const admin = requireRole(session, ["super_admin", "finanzas"]);

  const record = await upsertCommissionPayment({
    brokerId,
    operacionFecha,
    operacionMonto,
    montoComision,
    actorEmail: admin.email,
  });
  await setCommissionPaymentStatus({ id: record.id, estatus, actorEmail: admin.email });
  revalidatePath("/backoffice/comisiones");
}
