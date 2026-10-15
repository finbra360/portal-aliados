// Brokers (aliados) en la base del backoffice: alta, edición y carga masiva.
// Reemplaza a la pestaña "Brokers" del Google Sheet. Todo cambio queda en
// audit_log.

import { sql, transaccion } from "@/lib/db";
import { logAudit } from "@/lib/db/audit";
import { getLeaderboard } from "@/lib/n8n";
import { asignarIds, normalizarId, revisarImportacion, validarBroker, type FilaImportacion } from "@/lib/brokers/importar";

export class BrokerError extends Error {}

export interface Broker {
  id: string;
  email: string;
  nombre: string;
  telefono: string | null;
  createdBy: string;
  createdAt: string;
  updatedBy: string | null;
  updatedAt: string;
}

const mapBroker = (r: Record<string, unknown>): Broker => ({
  id: r.id as string,
  email: r.email as string,
  nombre: r.nombre as string,
  telefono: (r.telefono as string | null) ?? null,
  createdBy: r.created_by as string,
  createdAt: (r.created_at as Date).toISOString(),
  updatedBy: (r.updated_by as string | null) ?? null,
  updatedAt: (r.updated_at as Date).toISOString(),
});

/** Orden por ID numérico: B002 antes que B010 y B1000 después de B999. */
export async function listBrokers(): Promise<Broker[]> {
  const rows = await sql`SELECT * FROM brokers ORDER BY length(id), id`;
  return rows.map(mapBroker);
}

export async function getBroker(id: string): Promise<Broker | null> {
  const [row] = await sql`SELECT * FROM brokers WHERE id = ${id}`;
  return row ? mapBroker(row) : null;
}

async function correosExistentes(): Promise<Map<string, string>> {
  const rows = await sql`SELECT id, email FROM brokers`;
  return new Map(rows.map((r) => [r.email as string, r.id as string]));
}

/**
 * Alta individual. El ID es el código de Lendia si se captura; si no, se
 * genera (B###). Regresa el ID asignado.
 */
export async function crearBroker(p: { email: string; nombre: string; telefono?: string | null; id?: string | null; actor: string }): Promise<string> {
  const v = validarBroker(p);
  if (!v.ok) throw new BrokerError(v.error);
  const id = normalizarId(p.id);
  if (id === "error") throw new BrokerError("El ID solo puede llevar letras, números y guiones (por ejemplo FAPBR044)");
  const [existe] = await sql`SELECT id FROM brokers WHERE email = ${v.email}`;
  if (existe) throw new BrokerError(`Ese correo ya está dado de alta como ${existe.id}`);
  if (id) {
    const [otro] = await sql`SELECT email FROM brokers WHERE id = ${id}`;
    if (otro) throw new BrokerError(`El ID ${id} ya es de ${otro.email}`);
  }
  const [creado] = await guardarNuevos([{ email: v.email, nombre: v.nombre, telefono: v.telefono, id }], p.actor);
  if (!creado) throw new BrokerError("Ese correo o ese ID se acaban de dar de alta. Revisa la lista.");
  await logAudit({ actorEmail: p.actor, action: "crear_broker", entityType: "broker", entityId: creado });
  return creado;
}

export async function editarBroker(p: { id: string; email: string; nombre: string; telefono?: string | null; actor: string }): Promise<void> {
  const v = validarBroker(p);
  if (!v.ok) throw new BrokerError(v.error);
  const [otro] = await sql`SELECT id FROM brokers WHERE email = ${v.email} AND id <> ${p.id}`;
  if (otro) throw new BrokerError(`Ese correo ya es de ${otro.id}`);
  const [antes] = await sql`SELECT email, nombre, telefono FROM brokers WHERE id = ${p.id}`;
  if (!antes) throw new BrokerError("Ese broker no existe");
  await sql`
    UPDATE brokers SET email = ${v.email}, nombre = ${v.nombre}, telefono = ${v.telefono}, updated_by = ${p.actor}, updated_at = now()
    WHERE id = ${p.id}
  `;
  const cambios = (["email", "nombre", "telefono"] as const).filter((k) => (antes[k] ?? null) !== v[k]);
  await logAudit({ actorEmail: p.actor, action: "editar_broker", entityType: "broker", entityId: p.id, metadata: { cambios } });
}

/**
 * IDs que ya usa el historial de colocación (Sheet, vía n8n). Mientras haya
 * brokers del Sheet sin importar, un ID nuevo no debe caer en uno de esos: el
 * broker nuevo heredaría la colocación de otro. Si n8n no responde, no se
 * numera nada (mejor fallar que asignar un ID ajeno).
 */
async function idsDelHistorial(): Promise<string[]> {
  try {
    return (await getLeaderboard()).ranking.map((b) => b.brokerId);
  } catch {
    throw new BrokerError("No pudimos confirmar qué IDs ya usa el historial de colocación (n8n no respondió). Intenta en un momento, o pon el ID en el archivo.");
  }
}

/**
 * Inserta brokers nuevos con IDs. Un candado sobre la tabla evita que dos
 * altas al mismo tiempo tomen el mismo número. Los correos que ya existan se
 * saltan (ON CONFLICT). Regresa los IDs insertados.
 */
async function guardarNuevos(nuevos: { email: string; nombre: string; telefono: string | null; id: string | null }[], actor: string): Promise<string[]> {
  if (nuevos.length === 0) return [];
  const reservados = nuevos.some((b) => !b.id) ? await idsDelHistorial() : [];
  return transaccion(async (tx) => {
    await tx`LOCK TABLE brokers IN SHARE ROW EXCLUSIVE MODE`;
    const ids = (await tx`SELECT id FROM brokers`).map((r) => r.id as string);
    const filas = asignarIds(nuevos, [...ids, ...reservados]).map((b) => ({ id: b.id, email: b.email, nombre: b.nombre, telefono: b.telefono, created_by: actor }));
    const insertados = await tx`
      INSERT INTO brokers ${tx(filas, "id", "email", "nombre", "telefono", "created_by")}
      ON CONFLICT DO NOTHING
      RETURNING id
    `;
    return insertados.map((r) => r.id as string);
  });
}

export async function previsualizarImportacion(texto: string): Promise<{ filas: FilaImportacion[] } | { error: string }> {
  return revisarImportacion(texto, await correosExistentes());
}

/**
 * Guarda la carga masiva. Se vuelve a validar contra la base en este momento
 * (no se confía en la vista previa); los que tienen error o ya existen se
 * omiten.
 */
export async function importarBrokers(texto: string, actor: string): Promise<{ creados: string[]; existentes: number; errores: number }> {
  const r = revisarImportacion(texto, await correosExistentes());
  if ("error" in r) throw new BrokerError(r.error);
  const nuevos = r.filas.filter((f) => f.estado === "nuevo");
  const creados = await guardarNuevos(nuevos, actor);
  const omitidos = nuevos.length - creados.length;
  const resultado = {
    creados,
    existentes: r.filas.filter((f) => f.estado === "existe").length + omitidos,
    errores: r.filas.filter((f) => f.estado === "error").length,
  };
  await logAudit({
    actorEmail: actor,
    action: "importar_brokers",
    entityType: "broker",
    metadata: { creados: creados.length, existentes: resultado.existentes, errores: resultado.errores, ids: creados },
  });
  return resultado;
}
