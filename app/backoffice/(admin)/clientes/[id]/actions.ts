"use server";

import { revalidatePath } from "next/cache";
import { getAdminSession } from "@/lib/get-admin-session";
import { requierePermiso } from "@/lib/permisos";
import { codigoDeError } from "@/lib/collections/errors";
import { EmpresaError, actualizarEmpresa, type DatosEmpresa } from "@/lib/db/empresas";

export type EmpresaActionResult = { ok: true; mensaje: string } | { ok: false; error: string };

const texto = (fd: FormData, k: string) => String(fd.get(k) ?? "");

export async function editarEmpresaAction(id: string, _prev: EmpresaActionResult | null, fd: FormData): Promise<EmpresaActionResult> {
  const admin = requierePermiso(await getAdminSession(), "clientes.editar");
  const datos: DatosEmpresa = {
    nombre: texto(fd, "nombre"),
    razonSocial: texto(fd, "razonSocial"),
    rfc: texto(fd, "rfc"),
    nombreComercial: texto(fd, "nombreComercial"),
    industria: texto(fd, "industria"),
    sitioWeb: texto(fd, "sitioWeb"),
    ejecutivoEmail: texto(fd, "ejecutivoEmail"),
    notas: texto(fd, "notas"),
  };
  try {
    await actualizarEmpresa({ id, datos, actor: admin.email });
  } catch (e) {
    if (e instanceof EmpresaError) return { ok: false, error: e.message };
    const c = codigoDeError("clientes: editar empresa", e);
    return { ok: false, error: `No pudimos guardar los cambios. Intenta de nuevo. (código ${c})` };
  }
  revalidatePath("/backoffice/clientes", "layout");
  return { ok: true, mensaje: "Cambios guardados." };
}
