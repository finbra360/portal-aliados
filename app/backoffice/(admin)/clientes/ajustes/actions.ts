"use server";

import { revalidatePath } from "next/cache";
import { getAdminSession } from "@/lib/get-admin-session";
import { requierePermiso } from "@/lib/permisos";
import { codigoDeError } from "@/lib/collections/errors";
import { validarAjustes, CAMPOS, type ClaveAjustes } from "@/lib/clientes/ajustes";
import { AjustesError, guardarAjustes, guardarEjecutivoPorOmision } from "@/lib/db/ajustes-clientes";
import { validarListasDocumentos } from "@/lib/clientes/comite";
import { guardarListasDocumentos } from "@/lib/db/comite";

/** En un error se regresa lo que se capturó, para que el formulario no lo pierda. */
export type AjustesResult = { ok: true; mensaje: string } | { ok: false; error: string; entrada?: Record<string, string | null> };

function refrescar() {
  revalidatePath("/backoffice/clientes", "layout");
  revalidatePath("/backoffice/inicio");
}

/** Guarda la salud o los playbooks (Super Admin). */
export async function guardarAjustesAction(clave: ClaveAjustes, _prev: AjustesResult | null, fd: FormData): Promise<AjustesResult> {
  const admin = requierePermiso(await getAdminSession(), "clientes.configurar");
  const entrada = Object.fromEntries(CAMPOS[clave].map((c) => [c.clave, fd.get(c.clave) === null ? null : String(fd.get(c.clave))]));
  const v = validarAjustes(clave, entrada);
  if (!v.ok) return { ok: false, error: v.error, entrada };
  try {
    const n = await guardarAjustes({ clave, valor: v.valor, actor: admin.email });
    refrescar();
    return { ok: true, mensaje: n === 0 ? "No había cambios." : `Guardado: ${n} ${n === 1 ? "valor cambió" : "valores cambiaron"}. Se aplica desde ya.` };
  } catch (e) {
    const c = codigoDeError(`clientes: ajustes ${clave}`, e);
    return { ok: false, error: `No pudimos guardar los ajustes. Intenta de nuevo. (código ${c})` };
  }
}

/** Documentos del expediente por producto (Super Admin). */
export async function guardarDocumentosAction(_prev: AjustesResult | null, fd: FormData): Promise<AjustesResult> {
  const admin = requierePermiso(await getAdminSession(), "clientes.configurar");
  const v = validarListasDocumentos(Object.fromEntries(fd.entries()));
  if (!v.ok) return { ok: false, error: v.error };
  try {
    const cambio = await guardarListasDocumentos({ listas: v.datos, actor: admin.email });
    refrescar();
    revalidatePath("/backoffice/negocios", "layout");
    return { ok: true, mensaje: cambio ? "Guardado. Los negocios ya piden esta lista." : "No había cambios." };
  } catch (e) {
    const c = codigoDeError("clientes: documentos del expediente", e);
    return { ok: false, error: `No pudimos guardar. Intenta de nuevo. (código ${c})` };
  }
}

/** Guarda el ejecutivo por omisión de las empresas nuevas (Super Admin). */
export async function guardarEjecutivoPorOmisionAction(_prev: AjustesResult | null, fd: FormData): Promise<AjustesResult> {
  const admin = requierePermiso(await getAdminSession(), "clientes.configurar");
  try {
    const cambio = await guardarEjecutivoPorOmision({ email: String(fd.get("email") ?? "") || null, actor: admin.email });
    refrescar();
    return { ok: true, mensaje: cambio ? "Guardado. Aplica a las empresas que se den de alta desde ahora." : "No había cambios." };
  } catch (e) {
    if (e instanceof AjustesError) return { ok: false, error: e.message };
    const c = codigoDeError("clientes: ejecutivo por omisión", e);
    return { ok: false, error: `No pudimos guardar. Intenta de nuevo. (código ${c})` };
  }
}
