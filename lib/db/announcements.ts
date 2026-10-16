import { sql } from "@/lib/db";
import { logAudit } from "./audit";
import { audienciaIncluye, leerAudiencia, type Audiencia, type AnuncioNuevo } from "@/lib/anuncios";

export interface Announcement {
  id: number;
  titulo: string;
  mensaje: string;
  ctaTexto: string | null;
  ctaUrl: string | null;
  audiencia: Audiencia;
  fechaPublicacion: string;
  fechaExpiracion: string | null;
  createdBy: string | null;
  /** Solo en el listado del backoffice: cuántos brokers ya lo abrieron. */
  leidos: number;
}

function mapRow(r: Record<string, unknown>): Announcement {
  return {
    id: r.id as number,
    titulo: r.titulo as string,
    mensaje: r.mensaje as string,
    ctaTexto: (r.cta_texto as string) ?? null,
    ctaUrl: (r.cta_url as string) ?? null,
    audiencia: leerAudiencia(r.audiencia),
    fechaPublicacion: (r.fecha_publicacion as Date).toISOString(),
    fechaExpiracion: r.fecha_expiracion ? (r.fecha_expiracion as Date).toISOString() : null,
    createdBy: (r.created_by as string) ?? null,
    leidos: Number(r.leidos ?? 0),
  };
}

/**
 * Todos, del más reciente al más viejo, con cuántos brokers lo leyeron
 * (backoffice). `ahora` es la hora de la base: las fechas se guardaron con su
 * reloj, y compararlas con el del servidor web marcaba "programado" un anuncio
 * recién publicado cuando los relojes difieren unos segundos.
 */
export async function listAnnouncements(): Promise<{ anuncios: Announcement[]; ahora: string }> {
  const rows = await sql`
    SELECT a.*, (SELECT count(*) FROM announcement_reads r WHERE r.announcement_id = a.id)::int AS leidos, now() AS ahora
    FROM announcements a
    ORDER BY a.fecha_publicacion DESC, a.id DESC
    LIMIT 200
  `;
  const [{ ahora }] = rows.length ? rows : await sql`SELECT now() AS ahora`;
  return { anuncios: rows.map(mapRow), ahora: (ahora as Date).toISOString() };
}

/**
 * `expiraEl` (YYYY-MM-DD) es el último día visible: expira al terminar ese día
 * en hora de CDMX, es decir, al inicio del día siguiente.
 */
export async function createAnnouncement(params: AnuncioNuevo & { actorEmail: string }): Promise<Announcement> {
  const rows = await sql`
    INSERT INTO announcements (titulo, mensaje, cta_texto, cta_url, audiencia, fecha_expiracion, created_by)
    VALUES (
      ${params.titulo}, ${params.mensaje}, ${params.ctaTexto}, ${params.ctaUrl},
      ${JSON.stringify(params.audiencia)}::text::jsonb,
      ${params.expiraEl}::date::timestamp AT TIME ZONE 'America/Mexico_City' + interval '1 day',
      ${params.actorEmail}
    )
    RETURNING *
  `;
  const anuncio = mapRow(rows[0]);
  await logAudit({
    actorEmail: params.actorEmail,
    action: "create_announcement",
    entityType: "announcement",
    entityId: String(anuncio.id),
    metadata: { titulo: anuncio.titulo, audiencia: anuncio.audiencia.tipo },
  });
  return anuncio;
}

/** Lo retira de inmediato: ningún broker vuelve a verlo. */
export async function endAnnouncement(params: { id: number; actorEmail: string }): Promise<void> {
  const rows = await sql`
    UPDATE announcements SET fecha_expiracion = now()
    WHERE id = ${params.id} AND (fecha_expiracion IS NULL OR fecha_expiracion > now())
    RETURNING id
  `;
  if (!rows[0]) return;
  await logAudit({ actorEmail: params.actorEmail, action: "end_announcement", entityType: "announcement", entityId: String(params.id) });
}

export interface AnuncioParaBroker {
  id: number;
  titulo: string;
  mensaje: string;
  ctaTexto: string | null;
  ctaUrl: string | null;
  fechaPublicacion: string;
  leido: boolean;
}

/** Los vigentes que le tocan a este broker, nuevos primero. */
export async function anunciosParaBroker(brokerId: string): Promise<AnuncioParaBroker[]> {
  const rows = await sql`
    SELECT a.*, (r.broker_id IS NOT NULL) AS leido
    FROM announcements a
    LEFT JOIN announcement_reads r ON r.announcement_id = a.id AND r.broker_id = ${brokerId}
    WHERE a.fecha_publicacion <= now() AND (a.fecha_expiracion IS NULL OR a.fecha_expiracion > now())
    ORDER BY a.fecha_publicacion DESC, a.id DESC
    LIMIT 50
  `;
  return rows
    .map((r) => ({ ...mapRow(r), leido: Boolean(r.leido) }))
    .filter((a) => audienciaIncluye(a.audiencia, brokerId))
    .slice(0, 10)
    .map((a) => ({
      id: a.id,
      titulo: a.titulo,
      mensaje: a.mensaje,
      ctaTexto: a.ctaTexto,
      ctaUrl: a.ctaUrl,
      fechaPublicacion: a.fechaPublicacion,
      leido: a.leido,
    }));
}

/** Marca como leídos los anuncios que este broker tiene a la vista ahora. */
export async function marcarAnunciosLeidos(brokerId: string): Promise<void> {
  const pendientes = (await anunciosParaBroker(brokerId)).filter((a) => !a.leido).map((a) => a.id);
  if (pendientes.length === 0) return;
  await sql`
    INSERT INTO announcement_reads (announcement_id, broker_id)
    SELECT unnest(${sql.array(pendientes)}::int[]), ${brokerId}
    ON CONFLICT DO NOTHING
  `;
}
