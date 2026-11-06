"use server";

import { revalidatePath } from "next/cache";
import { getAdminSession } from "@/lib/get-admin-session";
import { requierePermiso } from "@/lib/permisos";
import { codigoDeError } from "@/lib/collections/errors";
import { EmpresaError, actualizarEmpresa, type DatosEmpresa } from "@/lib/db/empresas";
import { PersonaError, agregarCanal, asignarCanal, guardarPersona, registrarActividad } from "@/lib/db/personas";
import { validarActividad, validarPersona } from "@/lib/clientes/personas";
import { TareaError, cerrarTarea, crearTarea } from "@/lib/db/tareas";
import { validarTarea } from "@/lib/clientes/tareas";
import { fechaMexico } from "@/lib/collections/rules";

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

// ---------------------------------------------------------------- personas y actividad

/** Corre `fn` con el permiso de editar clientes y traduce los errores conocidos a un mensaje. */
async function conPermiso(etiqueta: string, mensajeOk: string, fn: (actor: string) => Promise<unknown>): Promise<EmpresaActionResult> {
  const admin = requierePermiso(await getAdminSession(), "clientes.editar");
  try {
    await fn(admin.email);
  } catch (e) {
    if (e instanceof PersonaError || e instanceof TareaError) return { ok: false, error: e.message };
    const c = codigoDeError(`clientes: ${etiqueta}`, e);
    return { ok: false, error: `No pudimos guardar. Intenta de nuevo. (código ${c})` };
  }
  revalidatePath("/backoffice/clientes", "layout");
  revalidatePath("/backoffice/cobranza/clientes", "layout");
  return { ok: true, mensaje: mensajeOk };
}

export async function guardarPersonaAction(empresaId: string, personaId: string | null, _prev: EmpresaActionResult | null, fd: FormData): Promise<EmpresaActionResult> {
  const v = validarPersona(Object.fromEntries(fd.entries()));
  if (!v.ok) return { ok: false, error: v.error };
  return conPermiso("guardar persona", personaId ? "Cambios guardados." : "Persona agregada.", (actor) =>
    guardarPersona({ empresaId, personaId: personaId ?? undefined, datos: v.datos, actor }),
  );
}

export async function asignarCanalAction(empresaId: string, contactId: string, personaId: string | null): Promise<EmpresaActionResult> {
  return conPermiso("asignar canal", "Listo.", (actor) => asignarCanal({ empresaId, contactId, personaId, actor }));
}

export async function agregarCanalAction(empresaId: string, personaId: string, _prev: EmpresaActionResult | null, fd: FormData): Promise<EmpresaActionResult> {
  const tipo = texto(fd, "tipo") === "email" ? "email" : "telefono";
  return conPermiso("agregar canal", tipo === "email" ? "Correo agregado." : "Teléfono agregado.", (actor) =>
    agregarCanal({ empresaId, personaId, tipo, valor: texto(fd, "valor"), actor }),
  );
}

export async function registrarActividadAction(empresaId: string, _prev: EmpresaActionResult | null, fd: FormData): Promise<EmpresaActionResult> {
  const v = validarActividad(Object.fromEntries(fd.entries()));
  if (!v.ok) return { ok: false, error: v.error };
  return conPermiso("registrar actividad", "Actividad registrada.", (actor) => registrarActividad({ empresaId, datos: v.datos, actor }));
}

// ---------------------------------------------------------------- tareas

export async function crearTareaAction(empresaId: string, _prev: EmpresaActionResult | null, fd: FormData): Promise<EmpresaActionResult> {
  const v = validarTarea(Object.fromEntries(fd.entries()), fechaMexico());
  if (!v.ok) return { ok: false, error: v.error };
  const r = await conPermiso("crear tarea", "Tarea creada.", (actor) => crearTarea({ empresaId, datos: v.datos, actor }));
  if (r.ok) revalidatePath("/backoffice/inicio");
  return r;
}

export async function cerrarTareaAction(empresaId: string, tareaId: string, estado: "hecha" | "cancelada", resultado: string): Promise<EmpresaActionResult> {
  if (estado !== "hecha" && estado !== "cancelada") return { ok: false, error: "Estado no válido." };
  const r = await conPermiso("cerrar tarea", estado === "hecha" ? "Tarea hecha." : "Tarea cancelada.", (actor) => cerrarTarea({ empresaId, tareaId, estado, resultado, actor }));
  if (r.ok) revalidatePath("/backoffice/inicio");
  return r;
}
