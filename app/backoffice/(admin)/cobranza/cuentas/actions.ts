"use server";

import { revalidatePath } from "next/cache";
import { getAdminSession } from "@/lib/get-admin-session";
import { COBRANZA_ROLES, requireRole } from "@/lib/rbac";
import { codigoDeError } from "@/lib/collections/errors";
import {
  PaymentAccountError,
  asignarCuentaASinCuenta,
  crearCuenta,
  editarCuenta,
  setCuentaActiva,
} from "@/lib/db/payment-accounts";

export type CuentaActionResult = { ok: true; mensaje?: string } | { ok: false; error: string };

async function run(fn: (actor: string) => Promise<string | void>): Promise<CuentaActionResult> {
  const admin = requireRole(await getAdminSession(), COBRANZA_ROLES);
  let mensaje: string | void;
  try {
    mensaje = await fn(admin.email);
  } catch (e) {
    if (e instanceof PaymentAccountError) return { ok: false, error: e.message };
    const c = codigoDeError("cuentas de pago", e);
    return { ok: false, error: `No pudimos guardar el cambio. Intenta de nuevo. (código ${c})` };
  }
  revalidatePath("/backoffice/cobranza/cuentas");
  revalidatePath("/backoffice/cobranza/clientes", "layout");
  return { ok: true, mensaje: mensaje || undefined };
}

const texto = (v: FormDataEntryValue | null) => String(v ?? "");

export async function crearCuentaAction(_prev: CuentaActionResult | null, fd: FormData): Promise<CuentaActionResult> {
  return run(async (actor) => {
    await crearCuenta({ alias: texto(fd.get("alias")), banco: texto(fd.get("banco")), beneficiario: texto(fd.get("beneficiario")), clabe: texto(fd.get("clabe")), actor });
    return "Cuenta dada de alta.";
  });
}

export async function editarCuentaAction(id: string, _prev: CuentaActionResult | null, fd: FormData): Promise<CuentaActionResult> {
  return run(async (actor) => {
    await editarCuenta({ id, alias: texto(fd.get("alias")), banco: texto(fd.get("banco")), beneficiario: texto(fd.get("beneficiario")), actor });
    return "Cambios guardados.";
  });
}

export async function setCuentaActivaAction(id: string, activa: boolean): Promise<CuentaActionResult> {
  return run((actor) => setCuentaActiva({ id, activa, actor }));
}

export async function asignarASinCuentaAction(id: string): Promise<CuentaActionResult> {
  return run(async (actor) => {
    const n = await asignarCuentaASinCuenta({ cuentaId: id, actor });
    return n === 1 ? "Se asignó a 1 cliente." : `Se asignó a ${n} clientes.`;
  });
}
