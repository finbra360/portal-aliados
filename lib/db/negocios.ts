// Negocios de crédito (crm_negocios_credito) y su historial de etapas. Las
// reglas están en lib/clientes/negocios.ts. Una empresa nueva se da de alta
// como prospecto (crm_empresas, origen 'manual') con su contacto; cuando el
// crédito llegue a SIAC se liga en la fase O6.

import { sql, transaccion } from "@/lib/db";
import { logAudit } from "@/lib/db/audit";
import { ambienteActual } from "@/lib/db/collections";
import { validarCambioEtapa, type DatosNegocio, type EtapaNegocio, type OrigenNegocio, type TipoNegocio } from "@/lib/clientes/negocios";

export class NegocioError extends Error {}

export interface Negocio {
  id: string;
  empresaId: string;
  empresa: string;
  /** La empresa ya es (o fue) cliente de SIAC. */
  esCliente: boolean;
  tipo: TipoNegocio;
  origen: OrigenNegocio;
  etapa: EtapaNegocio;
  etapaDesde: string;
  montoEstimado: number | null;
  responsableEmail: string | null;
  responsableNombre: string | null;
  motivoCierre: string | null;
  notas: string | null;
  createdAt: string;
  createdBy: string;
}

const SELECT_NEGOCIO = () => sql`
  SELECT n.*, e.nombre AS empresa, a.nombre AS responsable_nombre,
         EXISTS (SELECT 1 FROM col_clients c WHERE c.empresa_id = e.id) AS es_cliente
  FROM crm_negocios_credito n
  JOIN crm_empresas e ON e.id = n.empresa_id
  LEFT JOIN admin_users a ON a.email = n.responsable_email
`;

function mapNegocio(r: Record<string, unknown>): Negocio {
  return {
    id: r.id as string,
    empresaId: r.empresa_id as string,
    empresa: r.empresa as string,
    esCliente: !!r.es_cliente,
    tipo: r.tipo as TipoNegocio,
    origen: r.origen as OrigenNegocio,
    etapa: r.etapa as EtapaNegocio,
    etapaDesde: (r.etapa_desde as Date).toISOString(),
    montoEstimado: r.monto_estimado === null ? null : Number(r.monto_estimado),
    responsableEmail: (r.responsable_email as string) ?? null,
    responsableNombre: (r.responsable_nombre as string) ?? null,
    motivoCierre: (r.motivo_cierre as string) ?? null,
    notas: (r.notas as string) ?? null,
    createdAt: (r.created_at as Date).toISOString(),
    createdBy: r.created_by as string,
  };
}

/** La tabla existe (falta correr crm-schema.sql en ese ambiente). */
export async function hayNegocios(): Promise<boolean> {
  const [r] = await sql`SELECT to_regclass('public.crm_negocios_credito') IS NOT NULL AS hay`;
  return !!r?.hay;
}

/** Todos los negocios del ambiente; los cerrados (pospuestos y rechazados) de los últimos `diasCerrados` días. */
export async function getNegocios(p: { diasCerrados?: number } = {}): Promise<Negocio[]> {
  const dias = p.diasCerrados ?? 365;
  const rows = await sql`
    ${SELECT_NEGOCIO()}
    WHERE n.ambiente = ${ambienteActual()}
      AND (n.etapa NOT IN ('pospuesto', 'rechazado', 'dispersado') OR n.etapa_desde > now() - make_interval(days => ${dias}))
    ORDER BY n.etapa_desde
  `;
  return rows.map(mapNegocio);
}

export async function getNegociosEmpresa(empresaId: string): Promise<Negocio[]> {
  if (!(await hayNegocios())) return [];
  const rows = await sql`${SELECT_NEGOCIO()} WHERE n.empresa_id = ${empresaId} ORDER BY n.created_at DESC`;
  return rows.map(mapNegocio);
}

export interface CambioEtapa {
  de: EtapaNegocio | null;
  a: EtapaNegocio;
  motivo: string | null;
  actor: string;
  actorNombre: string | null;
  ocurridoAt: string;
}

export async function getNegocio(id: string): Promise<{ negocio: Negocio; etapas: CambioEtapa[] } | null> {
  const [r] = await sql`${SELECT_NEGOCIO()} WHERE n.id = ${id} AND n.ambiente = ${ambienteActual()}`;
  if (!r) return null;
  const etapas = await sql`
    SELECT h.de, h.a, h.motivo, h.actor, u.nombre AS actor_nombre, h.ocurrido_at
    FROM crm_negocio_etapas h LEFT JOIN admin_users u ON u.email = h.actor
    WHERE h.negocio_id = ${id} ORDER BY h.ocurrido_at DESC, h.id DESC
  `;
  return {
    negocio: mapNegocio(r),
    etapas: etapas.map((h) => ({
      de: (h.de as EtapaNegocio) ?? null,
      a: h.a as EtapaNegocio,
      motivo: (h.motivo as string) ?? null,
      actor: h.actor as string,
      actorNombre: (h.actor_nombre as string) ?? null,
      ocurridoAt: (h.ocurrido_at as Date).toISOString(),
    })),
  };
}

/** Empresas para elegir al crear un negocio: nombre, RFC y si ya es cliente. */
export async function empresasParaNegocio(): Promise<{ id: string; nombre: string; rfc: string | null; esCliente: boolean }[]> {
  const rows = await sql`
    SELECT e.id, e.nombre, e.rfc, EXISTS (SELECT 1 FROM col_clients c WHERE c.empresa_id = e.id) AS es_cliente
    FROM crm_empresas e WHERE e.ambiente = ${ambienteActual()} ORDER BY e.nombre
  `;
  return rows.map((r) => ({ id: r.id as string, nombre: r.nombre as string, rfc: (r.rfc as string) ?? null, esCliente: !!r.es_cliente }));
}

async function usuarioActivo(email: string | null) {
  if (!email) return;
  const [u] = await sql`SELECT 1 FROM admin_users WHERE email = ${email} AND activo`;
  if (!u) throw new NegocioError("El responsable tiene que ser un usuario activo del backoffice.");
}

/**
 * Da de alta un negocio. Si la empresa es nueva, la crea como prospecto (con
 * su contacto principal y sus teléfonos) en la misma transacción. El
 * responsable por omisión es quien lo crea; la empresa nueva queda con ese
 * mismo ejecutivo.
 */
export async function crearNegocio(p: { datos: DatosNegocio; actor: string }): Promise<string> {
  const d = p.datos;
  const ambiente = ambienteActual();
  const responsable = d.responsableEmail ?? p.actor;
  await usuarioActivo(responsable);

  if ("id" in d.empresa) {
    const [e] = await sql`SELECT id FROM crm_empresas WHERE id = ${d.empresa.id} AND ambiente = ${ambiente}`;
    if (!e) throw new NegocioError("Esa empresa no existe.");
  } else if (d.empresa.nueva.rfc) {
    const [otra] = await sql`SELECT nombre FROM crm_empresas WHERE ambiente = ${ambiente} AND rfc = ${d.empresa.nueva.rfc}`;
    if (otra) throw new NegocioError(`Ese RFC ya es de ${otra.nombre}: elígela en «Empresa de Clientes».`);
  }

  const { negocioId, empresaId, empresaNueva } = await transaccion(async (tx) => {
    let empresaId: string;
    let empresaNueva = false;
    if ("id" in d.empresa) {
      empresaId = d.empresa.id;
    } else {
      const e = d.empresa.nueva;
      const [row] = await tx`
        INSERT INTO crm_empresas (ambiente, nombre, razon_social, rfc, origen, ejecutivo_email, created_by, updated_by)
        VALUES (${ambiente}, ${e.nombre}, ${e.razonSocial}, ${e.rfc}, 'manual', ${responsable}, ${p.actor}, ${p.actor})
        RETURNING id
      `;
      empresaId = row.id as string;
      empresaNueva = true;
      if (d.contacto) {
        const c = d.contacto;
        const [per] = await tx`
          INSERT INTO crm_personas (empresa_id, nombre, puesto, es_principal, created_by, updated_by)
          VALUES (${empresaId}, ${c.nombre}, ${c.puesto}, true, ${p.actor}, ${p.actor})
          RETURNING id
        `;
        for (const [tipo, valor] of [["telefono", c.telefono], ["email", c.correo]] as const) {
          if (valor) await tx`INSERT INTO crm_persona_canales (persona_id, tipo, valor, created_by) VALUES (${per.id}, ${tipo}, ${valor}, ${p.actor})`;
        }
      }
    }
    const [n] = await tx`
      INSERT INTO crm_negocios_credito (ambiente, empresa_id, tipo, origen, monto_estimado, responsable_email, notas, created_by, updated_by)
      VALUES (${ambiente}, ${empresaId}, ${d.tipo}, ${d.origen}, ${d.montoEstimado}, ${responsable}, ${d.notas}, ${p.actor}, ${p.actor})
      RETURNING id
    `;
    await tx`INSERT INTO crm_negocio_etapas (negocio_id, de, a, actor) VALUES (${n.id}, NULL, 'prospecto', ${p.actor})`;
    return { negocioId: n.id as string, empresaId, empresaNueva };
  });

  if (empresaNueva) await logAudit({ actorEmail: p.actor, action: "alta_empresa_prospecto", entityType: "empresa", entityId: empresaId, metadata: { negocioId } });
  await logAudit({
    actorEmail: p.actor,
    action: "alta_negocio",
    entityType: "negocio",
    entityId: negocioId,
    metadata: { empresaId, tipo: d.tipo, origen: d.origen, montoEstimado: d.montoEstimado, responsable },
  });
  return negocioId;
}

/** Mueve un negocio de etapa (con las reglas de validarCambioEtapa) y lo deja en el historial. */
export async function cambiarEtapa(p: { id: string; etapa: string; motivo: string; actor: string }): Promise<EtapaNegocio> {
  const r = await transaccion(async (tx) => {
    const [n] = await tx`SELECT etapa FROM crm_negocios_credito WHERE id = ${p.id} AND ambiente = ${ambienteActual()} FOR UPDATE`;
    if (!n) throw new NegocioError("Ese negocio no existe.");
    const v = validarCambioEtapa(n.etapa as EtapaNegocio, p.etapa, p.motivo);
    if (!v.ok) throw new NegocioError(v.error);
    const cierre = v.datos.etapa === "pospuesto" || v.datos.etapa === "rechazado";
    await tx`
      UPDATE crm_negocios_credito
      SET etapa = ${v.datos.etapa}, etapa_desde = now(), motivo_cierre = ${cierre ? v.datos.motivo : null},
          updated_by = ${p.actor}, updated_at = now()
      WHERE id = ${p.id}
    `;
    await tx`INSERT INTO crm_negocio_etapas (negocio_id, de, a, motivo, actor) VALUES (${p.id}, ${n.etapa}, ${v.datos.etapa}, ${v.datos.motivo}, ${p.actor})`;
    return { de: n.etapa as EtapaNegocio, a: v.datos.etapa, motivo: v.datos.motivo };
  });
  await logAudit({ actorEmail: p.actor, action: "etapa_negocio", entityType: "negocio", entityId: p.id, metadata: r });
  return r.a;
}

/** Cambia monto estimado, responsable y notas. */
export async function editarNegocio(p: { id: string; montoEstimado: number | null; responsableEmail: string | null; notas: string | null; actor: string }) {
  await usuarioActivo(p.responsableEmail);
  const [antes] = await sql`SELECT monto_estimado, responsable_email, notas FROM crm_negocios_credito WHERE id = ${p.id} AND ambiente = ${ambienteActual()}`;
  if (!antes) throw new NegocioError("Ese negocio no existe.");
  const cambios: Record<string, { antes: unknown; despues: unknown } | true> = {};
  const montoAntes = antes.monto_estimado === null ? null : Number(antes.monto_estimado);
  if (montoAntes !== p.montoEstimado) cambios.monto_estimado = { antes: montoAntes, despues: p.montoEstimado };
  if ((antes.responsable_email ?? null) !== p.responsableEmail) cambios.responsable_email = { antes: antes.responsable_email ?? null, despues: p.responsableEmail };
  if ((antes.notas ?? null) !== p.notas) cambios.notas = true;
  if (Object.keys(cambios).length === 0) return false;
  await sql`
    UPDATE crm_negocios_credito SET monto_estimado = ${p.montoEstimado}, responsable_email = ${p.responsableEmail}, notas = ${p.notas},
      updated_by = ${p.actor}, updated_at = now()
    WHERE id = ${p.id}
  `;
  await logAudit({ actorEmail: p.actor, action: "editar_negocio", entityType: "negocio", entityId: p.id, metadata: { cambios } });
  return true;
}
