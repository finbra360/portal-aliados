"use server";

import { getAdminSession } from "@/lib/get-admin-session";
import { requireRole } from "@/lib/rbac";
import { codigoDeError } from "@/lib/collections/errors";
import { enviarReporteDiario } from "@/lib/db/reporte";

const LIMITE_MS = 25_000;

/** Manda el reporte diario a Slack ahora (aunque ya se haya mandado hoy). Solo Super Admin. */
export async function enviarReporteAction(): Promise<{ ok: true } | { ok: false; error: string }> {
  const admin = requireRole(await getAdminSession(), ["super_admin"]);
  if (!process.env.SLACK_COBRANZA_WEBHOOK_URL) return { ok: false, error: "Falta SLACK_COBRANZA_WEBHOOK_URL en Vercel" };
  try {
    // Si algo se atora (base o Slack), el botón muestra un error en lugar de quedarse pensando.
    const resultado = await Promise.race([
      enviarReporteDiario({ forzar: true, actor: admin.email }).then(() => "listo" as const),
      new Promise<"tarde">((ok) => setTimeout(() => ok("tarde"), LIMITE_MS)),
    ]);
    if (resultado === "tarde") return { ok: false, error: "Tardó demasiado en armarse el reporte. Intenta de nuevo en unos minutos." };
    return { ok: true };
  } catch (e) {
    const c = codigoDeError("reporte", e);
    return { ok: false, error: `No se pudo mandar el reporte. (código ${c})` };
  }
}
