"use server";

import { revalidatePath } from "next/cache";
import { getAdminSession } from "@/lib/get-admin-session";
import { requierePermiso } from "@/lib/permisos";
import { codigoDeError } from "@/lib/collections/errors";
import { correrRadar } from "@/lib/db/renovaciones";

export type RadarActionResult = { ok: true; mensaje: string } | { ok: false; error: string };

/** Corre el radar a mano (Super Admin). Es lo mismo que hace el cron después de la foto. */
export async function correrRadarAction(): Promise<RadarActionResult> {
  const admin = requierePermiso(await getAdminSession(), "clientes.configurar");
  try {
    const r = await correrRadar({ actor: admin.email });
    if (!r.corrio) return { ok: false, error: r.motivo };
    revalidatePath("/backoffice/clientes", "layout");
    revalidatePath("/backoffice/inicio");
    const n = (x: number, uno: string, varios: string) => `${x} ${x === 1 ? uno : varios}`;
    return {
      ok: true,
      mensaje: `Listo: ${n(r.abiertas, "oportunidad nueva", "oportunidades nuevas")}, ${n(r.recordatorios, "recordatorio", "recordatorios")} y ${n(r.cerradas, "cerrada", "cerradas")}.`,
    };
  } catch (e) {
    const c = codigoDeError("clientes: correr radar", e);
    return { ok: false, error: `No pudimos correr el radar. Intenta de nuevo. (código ${c})` };
  }
}
