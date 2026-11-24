"use server";

import { revalidatePath } from "next/cache";
import { getAdminSession } from "@/lib/get-admin-session";
import { requierePermiso } from "@/lib/permisos";
import { codigoDeError } from "@/lib/collections/errors";
import { EmpresaError, asignarEjecutivo } from "@/lib/db/empresas";

export type AsignarResult = { ok: true; mensaje: string } | { ok: false; error: string };

/** Asigna o quita el ejecutivo de las empresas elegidas en la lista de Clientes. */
export async function asignarEjecutivoAction(ids: string[], email: string | null): Promise<AsignarResult> {
  const admin = requierePermiso(await getAdminSession(), "clientes.editar");
  try {
    const n = await asignarEjecutivo({ ids, email, actor: admin.email });
    revalidatePath("/backoffice/clientes", "layout");
    revalidatePath("/backoffice/inicio");
    const sinCambio = ids.length - n;
    return {
      ok: true,
      mensaje:
        `Listo: ${n} ${n === 1 ? "empresa cambió" : "empresas cambiaron"} de ejecutivo.` +
        (sinCambio > 0 ? ` ${sinCambio} ya ${sinCambio === 1 ? "lo tenía" : "lo tenían"}.` : ""),
    };
  } catch (e) {
    if (e instanceof EmpresaError) return { ok: false, error: e.message };
    const c = codigoDeError("clientes: asignar ejecutivo", e);
    return { ok: false, error: `No pudimos asignar el ejecutivo. Intenta de nuevo. (código ${c})` };
  }
}
