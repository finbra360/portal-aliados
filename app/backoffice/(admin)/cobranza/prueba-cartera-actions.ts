"use server";

import { getAdminSession } from "@/lib/get-admin-session";
import { requierePermiso } from "@/lib/permisos";
import { codigoDeError } from "@/lib/collections/errors";
import { probarServiciosCartera } from "@/lib/db/siac-prueba-cartera";

const LIMITE_MS = 55_000;

export type PruebaCarteraResult = ({ ok: true } & Awaited<ReturnType<typeof probarServiciosCartera>>) | { ok: false; error: string };

/** Una llamada de prueba a ConsultarVistaCredito y otra a ConsultarClientes. No toca la cartera. Solo Super Admin. */
export async function probarServiciosCarteraAction(): Promise<PruebaCarteraResult> {
  const admin = requierePermiso(await getAdminSession(), "cobranza.configurar");
  try {
    const r = await Promise.race([
      probarServiciosCartera({ actor: admin.email }),
      new Promise<"tarde">((ok) => setTimeout(() => ok("tarde"), LIMITE_MS)),
    ]);
    if (r === "tarde") return { ok: false, error: "SIAC tardó demasiado en responder. La respuesta, si llega, queda en la bitácora de llamadas." };
    return { ok: true, ...r };
  } catch (e) {
    const c = codigoDeError("prueba servicios cartera", e);
    return { ok: false, error: `${(e as Error).message} (código ${c})` };
  }
}
