"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getAdminSession } from "@/lib/get-admin-session";
import { requierePermiso } from "@/lib/permisos";
import { codigoDeError } from "@/lib/collections/errors";
import { validarNegocio, validarSolicitud } from "@/lib/clientes/negocios";
import { NegocioError, cambiarEtapa, crearNegocio, editarNegocio, guardarSolicitud } from "@/lib/db/negocios";

export type NegocioResult = { ok: true; mensaje: string } | { ok: false; error: string };

const texto = (fd: FormData, k: string) => String(fd.get(k) ?? "");

function refrescar() {
  revalidatePath("/backoffice/negocios", "layout");
  revalidatePath("/backoffice/clientes", "layout");
}

/** Alta de un negocio (y de su empresa prospecto, si es nueva). Al terminar lleva a la ficha del negocio. */
export async function crearNegocioAction(_prev: NegocioResult | null, fd: FormData): Promise<NegocioResult> {
  const admin = requierePermiso(await getAdminSession(), "originacion.operar");
  const v = validarNegocio(Object.fromEntries(fd.entries()));
  if (!v.ok) return { ok: false, error: v.error };
  let id: string;
  try {
    id = await crearNegocio({ datos: v.datos, actor: admin.email });
  } catch (e) {
    if (e instanceof NegocioError) return { ok: false, error: e.message };
    const c = codigoDeError("originación: crear negocio", e);
    return { ok: false, error: `No pudimos crear el negocio. Intenta de nuevo. (código ${c})` };
  }
  refrescar();
  redirect(`/backoffice/negocios/${id}`);
}

export async function cambiarEtapaAction(id: string, _prev: NegocioResult | null, fd: FormData): Promise<NegocioResult> {
  const admin = requierePermiso(await getAdminSession(), "originacion.operar");
  try {
    await cambiarEtapa({
      id,
      etapa: texto(fd, "etapa"),
      entrada: { motivo: texto(fd, "motivo"), recontactarEl: texto(fd, "recontactarEl"), motivoRechazo: texto(fd, "motivoRechazo") },
      actor: admin.email,
    });
  } catch (e) {
    if (e instanceof NegocioError) return { ok: false, error: e.message };
    const c = codigoDeError("originación: cambiar etapa", e);
    return { ok: false, error: `No pudimos mover el negocio. Intenta de nuevo. (código ${c})` };
  }
  refrescar();
  return { ok: true, mensaje: "Etapa actualizada." };
}

/** Producto, monto, plazo, destino y garantía. */
export async function guardarSolicitudAction(id: string, _prev: NegocioResult | null, fd: FormData): Promise<NegocioResult> {
  const admin = requierePermiso(await getAdminSession(), "originacion.operar");
  const v = validarSolicitud(Object.fromEntries(fd.entries()));
  if (!v.ok) return { ok: false, error: v.error };
  try {
    const cambio = await guardarSolicitud({ id, datos: v.datos, actor: admin.email });
    refrescar();
    return { ok: true, mensaje: cambio ? "Solicitud guardada." : "No había cambios." };
  } catch (e) {
    if (e instanceof NegocioError) return { ok: false, error: e.message };
    const c = codigoDeError("originación: guardar solicitud", e);
    return { ok: false, error: `No pudimos guardar la solicitud. Intenta de nuevo. (código ${c})` };
  }
}

/** Responsable y notas. */
export async function editarNegocioAction(id: string, _prev: NegocioResult | null, fd: FormData): Promise<NegocioResult> {
  const admin = requierePermiso(await getAdminSession(), "originacion.operar");
  const notas = texto(fd, "notas").trim() || null;
  if (notas && notas.length > 4000) return { ok: false, error: "Las notas son demasiado largas (máximo 4,000 caracteres)." };
  try {
    const cambio = await editarNegocio({ id, responsableEmail: texto(fd, "responsableEmail").trim().toLowerCase() || null, notas, actor: admin.email });
    refrescar();
    return { ok: true, mensaje: cambio ? "Cambios guardados." : "No había cambios." };
  } catch (e) {
    if (e instanceof NegocioError) return { ok: false, error: e.message };
    const c = codigoDeError("originación: editar negocio", e);
    return { ok: false, error: `No pudimos guardar. Intenta de nuevo. (código ${c})` };
  }
}
