"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getAdminSession } from "@/lib/get-admin-session";
import { requierePermiso } from "@/lib/permisos";
import { codigoDeError } from "@/lib/collections/errors";
import { validarNegocio, validarSolicitud } from "@/lib/clientes/negocios";
import { NegocioError, cambiarBroker, cambiarEtapa, crearNegocio, editarNegocio, guardarMensajeBroker, guardarSolicitud } from "@/lib/db/negocios";
import { validarAnalisis, validarDecision, validarDocumentos, validarLigaExpediente, validarOferta } from "@/lib/clientes/comite";
import { getProcesoNegocio, guardarAnalisis, guardarExpediente, guardarOferta, registrarDecision } from "@/lib/db/comite";

export type NegocioResult = { ok: true; mensaje: string } | { ok: false; error: string };

const texto = (fd: FormData, k: string) => String(fd.get(k) ?? "");

function refrescar() {
  revalidatePath("/backoffice/negocios", "layout");
  revalidatePath("/backoffice/clientes", "layout");
  // El portal del broker muestra sus solicitudes (los negocios con broker).
  revalidatePath("/operaciones", "layout");
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

/** Cambia o quita el broker del negocio. */
export async function cambiarBrokerAction(id: string, _prev: NegocioResult | null, fd: FormData): Promise<NegocioResult> {
  const admin = requierePermiso(await getAdminSession(), "originacion.operar");
  try {
    const cambio = await cambiarBroker({ id, brokerId: texto(fd, "brokerId").trim() || null, actor: admin.email });
    refrescar();
    return { ok: true, mensaje: cambio ? "Broker actualizado." : "No había cambios." };
  } catch (e) {
    if (e instanceof NegocioError) return { ok: false, error: e.message };
    const c = codigoDeError("originación: cambiar broker", e);
    return { ok: false, error: `No pudimos guardar. Intenta de nuevo. (código ${c})` };
  }
}

/** Mensaje que el broker ve en su portal. */
export async function guardarMensajeBrokerAction(id: string, _prev: NegocioResult | null, fd: FormData): Promise<NegocioResult> {
  const admin = requierePermiso(await getAdminSession(), "originacion.operar");
  const mensaje = texto(fd, "mensajeBroker").trim() || null;
  if (mensaje && mensaje.length > 1000) return { ok: false, error: "El mensaje es demasiado largo (máximo 1,000 caracteres)." };
  try {
    await guardarMensajeBroker({ id, mensaje, actor: admin.email });
    refrescar();
    revalidatePath("/operaciones", "layout");
    return { ok: true, mensaje: mensaje ? "Mensaje guardado: el broker ya lo ve en su portal." : "Mensaje borrado." };
  } catch (e) {
    if (e instanceof NegocioError) return { ok: false, error: e.message };
    const c = codigoDeError("originación: mensaje al broker", e);
    return { ok: false, error: `No pudimos guardar el mensaje. Intenta de nuevo. (código ${c})` };
  }
}

// ---------------------------------------------------------------- análisis, oferta, expediente y comité (fase O5)

function errorDe(e: unknown, donde: string, que: string): NegocioResult {
  if (e instanceof NegocioError) return { ok: false, error: e.message };
  const c = codigoDeError(`originación: ${donde}`, e);
  return { ok: false, error: `No pudimos guardar ${que}. Intenta de nuevo. (código ${c})` };
}

/** Resultado de buró, capacidad de pago y notas. Solo quien analiza crédito. */
export async function guardarAnalisisAction(id: string, _prev: NegocioResult | null, fd: FormData): Promise<NegocioResult> {
  const admin = requierePermiso(await getAdminSession(), "originacion.analizar");
  const v = validarAnalisis(Object.fromEntries(fd.entries()));
  if (!v.ok) return { ok: false, error: v.error };
  try {
    const cambio = await guardarAnalisis({ id, datos: v.datos, actor: admin.email });
    refrescar();
    return { ok: true, mensaje: cambio ? "Análisis guardado." : "No había cambios." };
  } catch (e) {
    return errorDe(e, "guardar análisis", "el análisis");
  }
}

/** Monto, tasa, plazo, comisión por apertura y respuesta del cliente. */
export async function guardarOfertaAction(id: string, _prev: NegocioResult | null, fd: FormData): Promise<NegocioResult> {
  const admin = requierePermiso(await getAdminSession(), "originacion.operar");
  const v = validarOferta(Object.fromEntries(fd.entries()));
  if (!v.ok) return { ok: false, error: v.error };
  try {
    const cambio = await guardarOferta({ id, datos: v.datos, actor: admin.email });
    refrescar();
    return { ok: true, mensaje: cambio ? "Oferta guardada." : "No había cambios." };
  } catch (e) {
    return errorDe(e, "guardar oferta", "la oferta");
  }
}

/** Liga a la carpeta y estado de cada documento de la lista del producto. */
export async function guardarExpedienteAction(id: string, _prev: NegocioResult | null, fd: FormData): Promise<NegocioResult> {
  const admin = requierePermiso(await getAdminSession(), "originacion.operar");
  const entrada = Object.fromEntries(fd.entries());
  const liga = validarLigaExpediente(entrada.expedienteUrl);
  if (!liga.ok) return { ok: false, error: liga.error };
  try {
    const proceso = await getProcesoNegocio(id);
    if (!proceso) return { ok: false, error: "Falta correr crm-schema.sql para capturar el expediente." };
    const docs = validarDocumentos(
      proceso.documentos.map((d) => d.nombre),
      entrada,
    );
    if (!docs.ok) return { ok: false, error: docs.error };
    const n = await guardarExpediente({ id, url: liga.datos, documentos: docs.datos, actor: admin.email });
    refrescar();
    return { ok: true, mensaje: n ? "Expediente guardado." : "No había cambios." };
  } catch (e) {
    return errorDe(e, "guardar expediente", "el expediente");
  }
}

/** Decisión del comité. Solo quien decide en comité. */
export async function registrarDecisionAction(id: string, _prev: NegocioResult | null, fd: FormData): Promise<NegocioResult> {
  const admin = requierePermiso(await getAdminSession(), "originacion.decidir");
  const v = validarDecision(Object.fromEntries(fd.entries()));
  if (!v.ok) return { ok: false, error: v.error };
  try {
    const a = await registrarDecision({ id, datos: v.datos, actor: admin.email });
    refrescar();
    return { ok: true, mensaje: a === "formalizacion" ? "Aprobado: el negocio pasó a Formalización." : "Rechazado en comité: el negocio quedó cerrado." };
  } catch (e) {
    return errorDe(e, "decisión de comité", "la decisión");
  }
}
