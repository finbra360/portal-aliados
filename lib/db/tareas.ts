// Tareas del equipo (crm_tareas) y el resumen de «Mi cartera» del Inicio.

import { sql, transaccion } from "@/lib/db";
import { logAudit } from "@/lib/db/audit";
import { ambienteActual, getPhotoStatus } from "@/lib/db/collections";
import { getEmpresasLista } from "@/lib/db/empresas";
import { fechaMexico } from "@/lib/collections/rules";
import { TIPOS_TAREA, avisosDeCartera, type DatosTarea, type TipoTarea } from "@/lib/clientes/tareas";

export class TareaError extends Error {}

export interface Tarea {
  id: string;
  empresaId: string;
  empresa: string;
  titulo: string;
  descripcion: string | null;
  tipo: TipoTarea;
  venceEl: string;
  responsableEmail: string | null;
  responsableNombre: string | null;
  estado: "abierta" | "hecha" | "cancelada";
  origen: string;
  resultado: string | null;
  cerradaPor: string | null;
  cerradaAt: string | null;
  createdBy: string;
}

const mapTarea = (r: Record<string, unknown>): Tarea => ({
  id: String(r.id),
  empresaId: r.empresa_id as string,
  empresa: r.empresa as string,
  titulo: r.titulo as string,
  descripcion: (r.descripcion as string) ?? null,
  tipo: r.tipo as TipoTarea,
  venceEl: r.vence_el as string,
  responsableEmail: (r.responsable_email as string) ?? null,
  responsableNombre: (r.responsable_nombre as string) ?? null,
  estado: r.estado as Tarea["estado"],
  origen: r.origen as string,
  resultado: (r.resultado as string) ?? null,
  cerradaPor: (r.cerrada_por as string) ?? null,
  cerradaAt: r.cerrada_at ? (r.cerrada_at as Date).toISOString() : null,
  createdBy: r.created_by as string,
});

const SELECT_TAREA = () => sql`
  SELECT t.*, to_char(t.vence_el, 'YYYY-MM-DD') AS vence_el, e.nombre AS empresa, a.nombre AS responsable_nombre
  FROM crm_tareas t
  JOIN crm_empresas e ON e.id = t.empresa_id
  LEFT JOIN admin_users a ON a.email = t.responsable_email
`;

/** Tareas de una empresa: las abiertas (la más próxima primero) y las 20 cerradas más recientes. */
export async function getTareasEmpresa(empresaId: string): Promise<{ abiertas: Tarea[]; cerradas: Tarea[] }> {
  const [abiertas, cerradas] = await Promise.all([
    sql`${SELECT_TAREA()} WHERE t.empresa_id = ${empresaId} AND t.estado = 'abierta' ORDER BY t.vence_el, t.id`,
    sql`${SELECT_TAREA()} WHERE t.empresa_id = ${empresaId} AND t.estado <> 'abierta' ORDER BY t.cerrada_at DESC NULLS LAST LIMIT 20`,
  ]);
  return { abiertas: abiertas.map(mapTarea), cerradas: cerradas.map(mapTarea) };
}

/**
 * Crea una tarea manual. Si no se elige responsable, queda el ejecutivo de la
 * empresa y, si no tiene, quien la crea. El responsable debe ser un usuario activo.
 */
export async function crearTarea(p: { empresaId: string; datos: DatosTarea; actor: string }): Promise<string> {
  const [e] = await sql`SELECT ejecutivo_email FROM crm_empresas WHERE id = ${p.empresaId} AND ambiente = ${ambienteActual()}`;
  if (!e) throw new TareaError("Esa empresa no existe.");
  const responsable = p.datos.responsableEmail ?? e.ejecutivo_email ?? p.actor;
  const [u] = await sql`SELECT 1 FROM admin_users WHERE email = ${responsable} AND activo`;
  if (!u) throw new TareaError("El responsable tiene que ser un usuario activo del backoffice.");
  const [t] = await sql`
    INSERT INTO crm_tareas (empresa_id, titulo, descripcion, tipo, vence_el, responsable_email, origen, created_by)
    VALUES (${p.empresaId}, ${p.datos.titulo}, ${p.datos.descripcion}, ${p.datos.tipo}, ${p.datos.venceEl}, ${responsable}, 'manual', ${p.actor})
    RETURNING id
  `;
  await logAudit({ actorEmail: p.actor, action: "crear_tarea", entityType: "tarea", entityId: String(t.id), metadata: { empresaId: p.empresaId, responsable, venceEl: p.datos.venceEl } });
  return String(t.id);
}

/**
 * Marca una tarea abierta como hecha o cancelada, con su resultado, y deja una
 * nota en la actividad de la empresa para que quede en el historial.
 */
export async function cerrarTarea(p: { empresaId: string; tareaId: string; estado: "hecha" | "cancelada"; resultado: string | null; actor: string }) {
  if (!/^\d{1,18}$/.test(p.tareaId)) throw new TareaError("Esa tarea no existe.");
  const resultado = p.resultado?.trim() || null;
  if (resultado && resultado.length > 2000) throw new TareaError("El resultado es demasiado largo (máximo 2,000 caracteres).");
  await transaccion(async (tx) => {
    const [t] = await tx`
      UPDATE crm_tareas SET estado = ${p.estado}, resultado = ${resultado}, cerrada_por = ${p.actor}, cerrada_at = now()
      WHERE id = ${p.tareaId} AND empresa_id = ${p.empresaId} AND estado = 'abierta'
      RETURNING titulo, tipo
    `;
    if (!t) throw new TareaError("Esa tarea ya no está abierta.");
    const texto = `${p.estado === "hecha" ? "Tarea hecha" : "Tarea cancelada"} (${TIPOS_TAREA[t.tipo as TipoTarea] ?? t.tipo}): ${t.titulo}${resultado ? `. ${resultado}` : ""}`;
    await tx`INSERT INTO crm_actividades (empresa_id, tipo, descripcion, actor) VALUES (${p.empresaId}, 'nota', ${texto}, ${p.actor})`;
  });
}

/** Tipos de col_activities que son un contacto de una persona del equipo con el cliente. */
const CONTACTO_COBRANZA = ["llamada", "visita", "correo", "whatsapp_enviado", "promesa_creada"];

/** «Mi cartera»: las empresas de las que soy ejecutivo, mis tareas abiertas y los avisos de mis clientes. */
export async function getMiCartera(email: string) {
  const hoy = fechaMexico();
  const status = await getPhotoStatus();
  const [lista, tareas] = await Promise.all([
    getEmpresasLista(status.fechaCorte, { filtro: "mios", q: "", orden: "nombre", yo: email }),
    sql`
      ${SELECT_TAREA()}
      WHERE t.responsable_email = ${email} AND t.estado = 'abierta' AND e.ambiente = ${ambienteActual()}
      ORDER BY t.vence_el, t.id LIMIT 200
    `,
  ]);
  const ids = lista.items.map((e) => e.empresaId);
  const extras = ids.length
    ? await sql`
        SELECT e.id,
               EXISTS (SELECT 1 FROM crm_personas p WHERE p.empresa_id = e.id AND p.es_principal AND p.vigente) AS tiene_principal,
               greatest(
                 (SELECT max(a.ocurrido_at) FROM crm_actividades a WHERE a.empresa_id = e.id AND a.tipo <> 'nota' AND a.actor <> 'sistema'),
                 (SELECT max(a.ocurrido_at) FROM col_activities a JOIN col_clients c ON c.id = a.client_id
                   WHERE c.empresa_id = e.id AND a.actor <> 'sistema' AND a.tipo = ANY(${CONTACTO_COBRANZA}))
               ) AS ultimo_contacto
        FROM crm_empresas e WHERE e.id = ANY(${ids}::uuid[])
      `
    : [];
  const porId = new Map(extras.map((x) => [x.id as string, x]));
  const clientes = lista.items.map((e) => {
    const x = porId.get(e.empresaId);
    return {
      empresaId: e.empresaId,
      nombre: e.nombre,
      enMora: e.enMora,
      maxAtraso: e.maxAtraso,
      creditosVigentes: e.creditosVigentes,
      tienePrincipal: !!x?.tiene_principal,
      ultimoContacto: x?.ultimo_contacto ? (x.ultimo_contacto as Date).toISOString() : null,
    };
  });
  return { hoy, clientes: clientes.length, tareas: tareas.map(mapTarea), avisos: avisosDeCartera(clientes, hoy) };
}
