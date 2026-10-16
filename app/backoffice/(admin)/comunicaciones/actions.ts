"use server";

import { revalidatePath } from "next/cache";
import { getAdminSession } from "@/lib/get-admin-session";
import { requireRole } from "@/lib/rbac";
import { codigoDeError } from "@/lib/collections/errors";
import { fechaMexico } from "@/lib/collections/rules";
import { validarAnuncio } from "@/lib/anuncios";
import { createAnnouncement, endAnnouncement } from "@/lib/db/announcements";
import { COMUNICACIONES_EDITAN } from "./roles";

export type AnuncioResult = { ok: true; mensaje: string } | { ok: false; error: string };

const texto = (v: FormDataEntryValue | null) => String(v ?? "");

export async function crearAnuncioAction(_prev: AnuncioResult | null, fd: FormData): Promise<AnuncioResult> {
  const admin = requireRole(await getAdminSession(), COMUNICACIONES_EDITAN);

  const v = validarAnuncio(
    {
      titulo: texto(fd.get("titulo")),
      mensaje: texto(fd.get("mensaje")),
      ctaTexto: texto(fd.get("ctaTexto")),
      ctaUrl: texto(fd.get("ctaUrl")),
      audiencia: texto(fd.get("audiencia")),
      brokers: texto(fd.get("brokers")),
      expiraEl: texto(fd.get("expiraEl")),
    },
    fechaMexico(),
  );
  if (!v.ok) return { ok: false, error: v.error };

  try {
    const { ok: _ok, ...anuncio } = v;
    await createAnnouncement({ ...anuncio, actorEmail: admin.email });
  } catch (e) {
    return { ok: false, error: `No pudimos publicar el anuncio. Intenta de nuevo. (código ${codigoDeError("anuncios", e)})` };
  }
  revalidatePath("/backoffice/comunicaciones");
  return { ok: true, mensaje: "Anuncio publicado. Los brokers lo ven en sus Novedades." };
}

export async function terminarAnuncioAction(id: number) {
  const admin = requireRole(await getAdminSession(), COMUNICACIONES_EDITAN);
  await endAnnouncement({ id, actorEmail: admin.email });
  revalidatePath("/backoffice/comunicaciones");
}
