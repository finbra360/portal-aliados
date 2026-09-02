"use server";

import { revalidatePath } from "next/cache";
import { getAdminSession } from "@/lib/get-admin-session";
import { requireRole } from "@/lib/rbac";
import { setBrokerStatus, type BrokerEstatus } from "@/lib/db/broker-status";

export async function updateBrokerStatusAction(brokerId: string, estatus: BrokerEstatus) {
  const session = await getAdminSession();
  const admin = requireRole(session, ["super_admin", "comercial"]);
  await setBrokerStatus({ brokerId, estatus, actorEmail: admin.email });
  revalidatePath(`/backoffice/brokers/${brokerId}`);
}
