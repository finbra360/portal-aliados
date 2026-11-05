"use server";

import { revalidatePath } from "next/cache";
import { getAdminSession } from "@/lib/get-admin-session";
import { requierePermiso } from "@/lib/permisos";
import { codigoDeError } from "@/lib/collections/errors";
import { importarHubspot, previsualizarHubspot, type VistaPreviaHubspot } from "@/lib/db/importar-hubspot";
import { NUEVA, type Elecciones } from "@/lib/clientes/importar-hubspot";

const MAX = 2_000_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Solo pares clave → id de empresa (UUID) o «nueva»; lo demás se descarta. */
function limpiarElecciones(v: unknown): Elecciones {
  if (!v || typeof v !== "object" || Array.isArray(v)) return {};
  const pares = Object.entries(v as Record<string, unknown>)
    .filter(([k, x]) => k.length <= 300 && typeof x === "string" && (x === NUEVA || UUID.test(x)))
    .slice(0, 1000);
  return Object.fromEntries(pares) as Elecciones;
}

export async function previsualizarHubspotAction(texto: string): Promise<({ ok: true } & VistaPreviaHubspot) | { ok: false; error: string }> {
  requierePermiso(await getAdminSession(), "clientes.importar");
  if (texto.length > MAX) return { ok: false, error: "El archivo es demasiado grande." };
  try {
    const r = await previsualizarHubspot(texto);
    return "error" in r ? { ok: false, error: r.error } : { ok: true, ...r };
  } catch (e) {
    const c = codigoDeError("clientes: vista previa hubspot", e);
    return { ok: false, error: `No pudimos revisar el archivo. (código ${c})` };
  }
}

export async function importarHubspotAction(texto: string, elecciones: Elecciones = {}): Promise<{ ok: true; mensaje: string } | { ok: false; error: string }> {
  const admin = requierePermiso(await getAdminSession(), "clientes.importar");
  if (texto.length > MAX) return { ok: false, error: "El archivo es demasiado grande." };
  try {
    const r = await importarHubspot(texto, admin.email, limpiarElecciones(elecciones));
    revalidatePath("/backoffice/clientes", "layout");
    const partes = [
      `${r.negocios} negocios importados`,
      `${r.empresasNuevas} empresas nuevas`,
      `${r.empresasLigadas} ligadas a clientes que ya existían`,
      r.gruposOmitidos ? `${r.gruposOmitidos} empresas omitidas por error` : null,
      r.filasOmitidas ? `${r.filasOmitidas} filas omitidas por error` : null,
    ].filter(Boolean);
    return { ok: true, mensaje: `${partes.join(" · ")}.` };
  } catch (e) {
    const c = codigoDeError("clientes: importar hubspot", e);
    return { ok: false, error: `No pudimos importar. No se guardó nada. (código ${c})` };
  }
}
