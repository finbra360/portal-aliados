import { sql } from "@/lib/db";
import { logAudit } from "./audit";

export type ResourceStatus = "borrador" | "publicado";

export interface CmsResource {
  id: number;
  titulo: string;
  tipo: string;
  categoria: string;
  contenido: string | null;
  url: string | null;
  estatus: ResourceStatus;
  orden: number;
  createdAt: string;
  updatedAt: string;
}

function mapRow(r: Record<string, unknown>): CmsResource {
  return {
    id: r.id as number,
    titulo: r.titulo as string,
    tipo: r.tipo as string,
    categoria: r.categoria as string,
    contenido: (r.contenido as string) ?? null,
    url: (r.url as string) ?? null,
    estatus: r.estatus as ResourceStatus,
    orden: r.orden as number,
    createdAt: (r.created_at as Date).toISOString(),
    updatedAt: (r.updated_at as Date).toISOString(),
  };
}

export async function listResources(onlyPublished = false): Promise<CmsResource[]> {
  const rows = onlyPublished
    ? await sql`SELECT * FROM resources WHERE estatus = 'publicado' ORDER BY categoria, orden`
    : await sql`SELECT * FROM resources ORDER BY categoria, orden`;
  return rows.map(mapRow);
}

export async function createResource(params: {
  titulo: string;
  tipo: string;
  categoria: string;
  contenido?: string;
  url?: string;
  actorEmail: string;
}): Promise<CmsResource> {
  const rows = await sql`
    INSERT INTO resources (titulo, tipo, categoria, contenido, url)
    VALUES (${params.titulo}, ${params.tipo}, ${params.categoria}, ${params.contenido ?? null}, ${params.url ?? null})
    RETURNING *
  `;
  const resource = mapRow(rows[0]);
  await logAudit({ actorEmail: params.actorEmail, action: "create_resource", entityType: "resource", entityId: String(resource.id) });
  return resource;
}

export async function setResourceStatus(params: { id: number; estatus: ResourceStatus; actorEmail: string }): Promise<CmsResource> {
  const rows = await sql`
    UPDATE resources SET estatus = ${params.estatus}, updated_at = now() WHERE id = ${params.id} RETURNING *
  `;
  if (!rows[0]) {
    throw new Error("Recurso no encontrado");
  }
  await logAudit({
    actorEmail: params.actorEmail,
    action: "update_resource_status",
    entityType: "resource",
    entityId: String(params.id),
    metadata: { newEstatus: params.estatus },
  });
  return mapRow(rows[0]);
}
