"use server";

import { revalidatePath } from "next/cache";
import { getAdminSession } from "@/lib/get-admin-session";
import { codigoDeError } from "@/lib/collections/errors";
import { COBRANZA_ROLES, requireRole } from "@/lib/rbac";
import {
  ContactError,
  addManualContact,
  setContactEstatus,
  setContactTipo,
  setContactoCobranza,
} from "@/lib/db/collection-clients";
import { TIPOS_CONTACTO, type TipoContacto } from "@/lib/collections/contacts";
import {
  GestionError,
  atenderAlerta,
  cambiarEtapa,
  consultarSaldoAlDia,
  crearPromesa,
  pausarCobranza,
  reanudarCobranza,
  registrarGestion,
  resolverPromesa,
  type SaldoAlDia,
} from "@/lib/db/collection-gestiones";
import { CANALES_PROMESA, ETAPAS, type CanalPromesa, type Etapa } from "@/lib/collections/gestiones";
import { PaymentAccountError, asignarCuenta } from "@/lib/db/payment-accounts";

export type ActionResult = { ok: true } | { ok: false; error: string };

async function run(clientId: string, fn: (actor: string) => Promise<unknown>): Promise<ActionResult> {
  const admin = requireRole(await getAdminSession(), COBRANZA_ROLES);
  try {
    await fn(admin.email);
  } catch (e) {
    if (e instanceof ContactError || e instanceof GestionError || e instanceof PaymentAccountError) return { ok: false, error: e.message };
    const c = codigoDeError("acción", e);
    return { ok: false, error: `No pudimos guardar el cambio. Intenta de nuevo. (código ${c})` };
  }
  revalidatePath(`/backoffice/cobranza/clientes/${clientId}`);
  revalidatePath("/backoffice/cobranza/cola");
  return { ok: true };
}

const esTipo = (t: string): t is TipoContacto => t in TIPOS_CONTACTO;

export async function setRecipientAction(clientId: string, contactId: string | null): Promise<ActionResult> {
  return run(clientId, (actor) => setContactoCobranza({ clientId, contactId, actor }));
}

export async function setTipoAction(clientId: string, contactId: string, tipo: string): Promise<ActionResult> {
  if (!esTipo(tipo)) return { ok: false, error: "Tipo de contacto no válido" };
  return run(clientId, (actor) => setContactTipo({ contactId, tipo, actor }));
}

export async function setEstatusAction(clientId: string, contactId: string, estatus: string): Promise<ActionResult> {
  if (estatus !== "activo" && estatus !== "invalido" && estatus !== "baja") return { ok: false, error: "Estado no válido" };
  return run(clientId, (actor) => setContactEstatus({ contactId, estatus, actor }));
}

export async function addContactAction(clientId: string, _prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const tipo = String(formData.get("tipo") ?? "telefono") === "email" ? "email" : "telefono";
  const tipoContacto = String(formData.get("tipoContacto") ?? "");
  if (!esTipo(tipoContacto)) return { ok: false, error: "Elige el tipo de contacto" };
  return run(clientId, (actor) =>
    addManualContact({
      clientId,
      tipo,
      valor: String(formData.get("valor") ?? ""),
      nombre: String(formData.get("nombre") ?? "") || null,
      tipoContacto,
      notas: String(formData.get("notas") ?? "") || null,
      usarParaRecordatorios: formData.get("usarParaRecordatorios") === "on",
      actor,
    }),
  );
}

/** Cuenta a la que paga el cliente; "" la quita. */
export async function asignarCuentaAction(clientId: string, cuentaId: string): Promise<ActionResult> {
  return run(clientId, (actor) => asignarCuenta({ clientId, cuentaId: cuentaId || null, actor }));
}

// ---------------------------------------------------------------- gestiones

const canal = (v: FormDataEntryValue | null): CanalPromesa => {
  const c = String(v ?? "");
  return c in CANALES_PROMESA ? (c as CanalPromesa) : "llamada";
};
const texto = (v: FormDataEntryValue | null) => String(v ?? "").trim();

export async function registrarGestionAction(clientId: string, _prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const resultado = texto(fd.get("resultado")) || null;
  return run(clientId, (actor) =>
    registrarGestion({
      clientId,
      tipo: texto(fd.get("tipo")),
      resultado,
      descripcion: texto(fd.get("descripcion")),
      contactId: texto(fd.get("contactId")) || null,
      creditId: texto(fd.get("creditId")) || null,
      promesa: resultado === "promesa" ? { monto: texto(fd.get("monto")), fecha: texto(fd.get("fecha")), canal: canal(fd.get("canal")) } : null,
      actor,
    }),
  );
}

export async function crearPromesaAction(clientId: string, _prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  return run(clientId, (actor) =>
    crearPromesa({
      clientId,
      creditId: texto(fd.get("creditId")) || null,
      monto: texto(fd.get("monto")),
      fecha: texto(fd.get("fecha")),
      canal: canal(fd.get("canal")),
      notas: texto(fd.get("notas")) || null,
      actor,
    }),
  );
}

export async function resolverPromesaAction(clientId: string, promiseId: number, estado: string): Promise<ActionResult> {
  if (estado !== "cumplida" && estado !== "cancelada") return { ok: false, error: "Estado no válido" };
  return run(clientId, (actor) => resolverPromesa({ clientId, promiseId, estado, actor }));
}

export async function pausarAction(clientId: string, _prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  return run(clientId, (actor) => pausarCobranza({ clientId, hasta: texto(fd.get("hasta")), motivo: texto(fd.get("motivo")), actor }));
}

export async function reanudarAction(clientId: string): Promise<ActionResult> {
  return run(clientId, (actor) => reanudarCobranza({ clientId, actor }));
}

export async function atenderAlertaAction(clientId: string, alertId: number, estado: string): Promise<ActionResult> {
  if (estado !== "atendida" && estado !== "descartada") return { ok: false, error: "Estado no válido" };
  return run(clientId, (actor) => atenderAlerta({ clientId, alertId, estado, actor }));
}

export async function cambiarEtapaAction(clientId: string, creditId: string, etapa: string): Promise<ActionResult> {
  const e: Etapa | null = etapa === "" ? null : etapa in ETAPAS ? (etapa as Etapa) : null;
  if (etapa !== "" && !e) return { ok: false, error: "Etapa no válida" };
  return run(clientId, (actor) => cambiarEtapa({ clientId, creditId, etapa: e, actor }));
}

export async function saldoAlDiaAction(clientId: string, creditId: string): Promise<{ ok: true; saldo: SaldoAlDia } | { ok: false; error: string }> {
  let saldo: SaldoAlDia | null = null;
  const r = await run(clientId, async (actor) => {
    saldo = await consultarSaldoAlDia({ clientId, creditId, actor });
  });
  return r.ok && saldo ? { ok: true, saldo } : { ok: false, error: r.ok ? "No se obtuvo el saldo" : r.error };
}
