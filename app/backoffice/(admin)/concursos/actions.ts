"use server";

import { revalidatePath } from "next/cache";
import { getAdminSession } from "@/lib/get-admin-session";
import { requireRole } from "@/lib/rbac";
import { codigoDeError } from "@/lib/collections/errors";
import { fechaMexico } from "@/lib/collections/rules";
import { validarConcurso } from "@/lib/concursos";
import { normalizarId } from "@/lib/brokers/importar";
import {
  ConcursoError,
  createContest,
  excludeBrokerFromContest,
  finalizarConcurso,
  includeBrokerInContest,
  setContestStatus,
} from "@/lib/db/contests";
import { CONCURSOS_EDITAN } from "./roles";

export type ConcursoResult = { ok: true; mensaje: string } | { ok: false; error: string };

const texto = (v: FormDataEntryValue | null) => String(v ?? "");

function refrescar(id?: number) {
  revalidatePath("/backoffice/concursos");
  if (id !== undefined) revalidatePath(`/backoffice/concursos/${id}`);
  revalidatePath("/concursos");
}

async function intentar(contexto: string, fn: () => Promise<ConcursoResult>): Promise<ConcursoResult> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof ConcursoError) return { ok: false, error: e.message };
    return { ok: false, error: `No pudimos guardar el cambio. Intenta de nuevo. (código ${codigoDeError(contexto, e)})` };
  }
}

export async function crearConcursoAction(_prev: ConcursoResult | null, fd: FormData): Promise<ConcursoResult> {
  const admin = requireRole(await getAdminSession(), CONCURSOS_EDITAN);
  const v = validarConcurso(
    {
      nombre: texto(fd.get("nombre")),
      descripcion: texto(fd.get("descripcion")),
      fechaInicio: texto(fd.get("fechaInicio")),
      fechaFin: texto(fd.get("fechaFin")),
      criterio: texto(fd.get("criterio")),
      meta: texto(fd.get("meta")),
      premio: texto(fd.get("premio")),
      numGanadores: texto(fd.get("numGanadores")),
    },
    fechaMexico(),
  );
  if (!v.ok) return { ok: false, error: v.error };
  return intentar("concursos", async () => {
    const { ok: _ok, ...concurso } = v;
    await createContest({ ...concurso, actorEmail: admin.email });
    refrescar();
    return { ok: true, mensaje: "Concurso creado como borrador. Actívalo cuando quieras que los brokers lo vean." };
  });
}

export async function activarConcursoAction(id: number, estatus: "borrador" | "activo" | "pausado") {
  const admin = requireRole(await getAdminSession(), CONCURSOS_EDITAN);
  await setContestStatus({ id, estatus, actorEmail: admin.email });
  refrescar(id);
}

export async function finalizarConcursoAction(id: number, _prev: ConcursoResult | null, _fd: FormData): Promise<ConcursoResult> {
  const admin = requireRole(await getAdminSession(), CONCURSOS_EDITAN);
  return intentar("concursos", async () => {
    const { ganadores } = await finalizarConcurso({ id, actorEmail: admin.email });
    refrescar(id);
    return { ok: true, mensaje: ganadores === 0 ? "Concurso finalizado. Nadie cumplió para ganar." : `Concurso finalizado con ${ganadores} ganador(es).` };
  });
}

export async function excluirBrokerAction(contestId: number, _prev: ConcursoResult | null, fd: FormData): Promise<ConcursoResult> {
  const admin = requireRole(await getAdminSession(), CONCURSOS_EDITAN);
  const brokerId = normalizarId(texto(fd.get("brokerId")));
  if (!brokerId || brokerId === "error") return { ok: false, error: "Escribe un ID de broker válido" };
  return intentar("concursos", async () => {
    await excludeBrokerFromContest({ contestId, brokerId, actorEmail: admin.email });
    refrescar(contestId);
    return { ok: true, mensaje: `${brokerId} quedó fuera del concurso.` };
  });
}

export async function reincorporarBrokerAction(contestId: number, brokerId: string) {
  const admin = requireRole(await getAdminSession(), CONCURSOS_EDITAN);
  await includeBrokerInContest({ contestId, brokerId, actorEmail: admin.email });
  refrescar(contestId);
}
