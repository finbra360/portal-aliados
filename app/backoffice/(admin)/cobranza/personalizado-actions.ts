"use server";

import { getAdminSession } from "@/lib/get-admin-session";
import { requireRole } from "@/lib/rbac";
import { codigoDeError } from "@/lib/collections/errors";
import { probarListadoPersonalizado } from "@/lib/db/siac-personalizado";
import type { ResumenPersonalizado } from "@/lib/collections/personalizado";

const LIMITE_MS = 50_000;

export type PruebaPersonalizadoResult =
  | { ok: true; runId: number; filtro: string; llamadas: number; resumen: ResumenPersonalizado }
  | { ok: false; error: string };

/** Una llamada de prueba al Listado Cobranza Personalizado. No toca la cartera. Solo Super Admin. */
export async function probarPersonalizadoAction(): Promise<PruebaPersonalizadoResult> {
  const admin = requireRole(await getAdminSession(), ["super_admin"]);
  try {
    const r = await Promise.race([
      probarListadoPersonalizado({ actor: admin.email }),
      new Promise<"tarde">((ok) => setTimeout(() => ok("tarde"), LIMITE_MS)),
    ]);
    if (r === "tarde") return { ok: false, error: "SIAC tardó demasiado en responder. La respuesta, si llega, queda en la bitácora." };
    return { ok: true, ...r };
  } catch (e) {
    const c = codigoDeError("prueba listado personalizado", e);
    return { ok: false, error: `${(e as Error).message} (código ${c})` };
  }
}
