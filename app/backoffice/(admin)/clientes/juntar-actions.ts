"use server";

import { revalidatePath } from "next/cache";
import { getAdminSession } from "@/lib/get-admin-session";
import { requierePermiso } from "@/lib/permisos";
import { codigoDeError } from "@/lib/collections/errors";
import { JuntarError, juntarEmpresa, marcarRevisada } from "@/lib/db/juntar-empresas";

export type JuntarResult = { ok: true; mensaje: string; queda: string } | { ok: false; error: string };

const UUID = /^[0-9a-f-]{36}$/i;

function refrescar() {
  revalidatePath("/backoffice/clientes", "layout");
  revalidatePath("/backoffice/negocios", "layout");
}

/** Pasa todo de `seBorra` a `queda` y borra `seBorra` (Super Admin). */
export async function juntarEmpresaAction(queda: string, seBorra: string): Promise<JuntarResult> {
  const admin = requierePermiso(await getAdminSession(), "clientes.configurar");
  if (!UUID.test(queda) || !UUID.test(seBorra)) return { ok: false, error: "Elige la empresa con la que se junta." };
  try {
    const r = await juntarEmpresa({ queda, seBorra, actor: admin.email });
    refrescar();
    return { ok: true, mensaje: `«${r.seBorra}» quedó junta con «${r.queda}».`, queda };
  } catch (e) {
    if (e instanceof JuntarError) return { ok: false, error: e.message };
    const c = codigoDeError("clientes: juntar empresas", e);
    return { ok: false, error: `No pudimos juntarlas. No se cambió nada; intenta de nuevo. (código ${c})` };
  }
}

/** El prospecto es otra empresa: ya no sale en «Empresas por revisar». */
export async function marcarRevisadaAction(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const admin = requierePermiso(await getAdminSession(), "clientes.configurar");
  if (!UUID.test(id)) return { ok: false, error: "Esa empresa no es válida." };
  try {
    await marcarRevisada({ id, actor: admin.email });
    revalidatePath("/backoffice/clientes/revisar");
    return { ok: true };
  } catch (e) {
    const c = codigoDeError("clientes: marcar revisada", e);
    return { ok: false, error: `No pudimos guardarlo. Intenta de nuevo. (código ${c})` };
  }
}
