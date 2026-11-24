// Negocios de crédito (crm_negocios_credito) y su historial de etapas. Las
// reglas están en lib/clientes/negocios.ts. Una empresa nueva se da de alta
// como prospecto (crm_empresas, origen 'manual') con su contacto; cuando el
// crédito llegue a SIAC se liga en la fase O6.

import { sql, transaccion } from "@/lib/db";
import { logAudit } from "@/lib/db/audit";
import { ambienteActual } from "@/lib/db/collections";
import { fechaMexico } from "@/lib/collections/rules";
import {
  validarCambioEtapa,
  type DatosNegocio,
  type DatosSolicitud,
  type Destino,
  type EtapaNegocio,
  type OrigenNegocio,
  type Producto,
  type TipoGarantia,
  type TipoNegocio,
} from "@/lib/clientes/negocios";

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
  rfcEmpresa: string | null;
  producto: Producto | null;
  plazoMeses: number | null;
  destino: Destino | null;
  destinoDetalle: string | null;
  garantiaTipo: TipoGarantia | null;
  garantiaDetalle: string | null;
  garantiaValor: number | null;
  /** Pospuesto: cuándo volver a contactarlo (YYYY-MM-DD). */
  recontactarEl: string | null;
  rechazoMotivo: string | null;
  rechazoPor: "finbra" | "cliente" | null;
  /** De qué salió: 'lead:<id>', 'credit_health:<id>' u 'oportunidad:<id>'. */
  origenRef: string | null;
  /** Broker que lo trajo (fase O4); null antes de correr crm-schema.sql o si no es de broker. */
  brokerId: string | null;
  comisionAperturaPct: number | null;
  mensajeBroker: string | null;
  colocacionId: string | null;
  createdAt: string;
  createdBy: string;
}

const SELECT_NEGOCIO = () => sql`
  SELECT n.*, e.nombre AS empresa, e.rfc AS rfc_empresa, a.nombre AS responsable_nombre,
         to_char(n.recontactar_el, 'YYYY-MM-DD') AS recontactar,
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
    rfcEmpresa: (r.rfc_empresa as string) ?? null,
    producto: (r.producto as Producto) ?? null,
    plazoMeses: r.plazo_meses === null || r.plazo_meses === undefined ? null : Number(r.plazo_meses),
    destino: (r.destino as Destino) ?? null,
    destinoDetalle: (r.destino_detalle as string) ?? null,
    garantiaTipo: (r.garantia_tipo as TipoGarantia) ?? null,
    garantiaDetalle: (r.garantia_detalle as string) ?? null,
    garantiaValor: r.garantia_valor === null || r.garantia_valor === undefined ? null : Number(r.garantia_valor),
    recontactarEl: (r.recontactar as string) ?? null,
    rechazoMotivo: (r.rechazo_motivo as string) ?? null,
    rechazoPor: (r.rechazo_por as "finbra" | "cliente") ?? null,
    origenRef: (r.origen_ref as string) ?? null,
    brokerId: (r.broker_id as string) ?? null,
    comisionAperturaPct: r.comision_apertura_pct === null || r.comision_apertura_pct === undefined ? null : Number(r.comision_apertura_pct),
    mensajeBroker: (r.mensaje_broker as string) ?? null,
    colocacionId: r.colocacion_id === null || r.colocacion_id === undefined ? null : String(r.colocacion_id),
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
 *
 * Desde un origen (lead, Credit Health, oportunidad) llega `origenRef`: si ya
 * hay un negocio de ese origen se regresa ese, sin crear otro. Con
 * `reusarEmpresa`, una empresa nueva cuyo RFC (o nombre exacto) ya existe se
 * reusa en vez de dar error. `solicitud` llena de una vez los datos que ya se
 * conocen.
 */
export async function crearNegocio(p: {
  datos: DatosNegocio;
  actor: string;
  origenRef?: string;
  solicitud?: Partial<DatosSolicitud>;
  reusarEmpresa?: boolean;
}): Promise<string> {
  const d = { ...p.datos };
  const ambiente = ambienteActual();
  const responsable = d.responsableEmail ?? p.actor;
  await usuarioActivo(responsable);

  if (p.origenRef) {
    const [ya] = await sql`SELECT id FROM crm_negocios_credito WHERE origen_ref = ${p.origenRef}`;
    if (ya) return ya.id as string;
  }
  if ("id" in d.empresa) {
    const [e] = await sql`SELECT id FROM crm_empresas WHERE id = ${d.empresa.id} AND ambiente = ${ambiente}`;
    if (!e) throw new NegocioError("Esa empresa no existe.");
  } else {
    const nueva = d.empresa.nueva;
    const [otra] = nueva.rfc
      ? await sql`SELECT id, nombre FROM crm_empresas WHERE ambiente = ${ambiente} AND rfc = ${nueva.rfc}`
      : p.reusarEmpresa
        ? await sql`
            SELECT id, nombre FROM crm_empresas
            WHERE ambiente = ${ambiente} AND (lower(trim(nombre)) = lower(trim(${nueva.nombre})) OR lower(trim(razon_social)) = lower(trim(${nueva.razonSocial ?? nueva.nombre})))
            ORDER BY created_at LIMIT 1
          `
        : [];
    if (otra && !p.reusarEmpresa) throw new NegocioError(`Ese RFC ya es de ${otra.nombre}: elígela en «Empresa de Clientes».`);
    if (otra) {
      d.empresa = { id: otra.id as string };
      d.contacto = null;
    }
  }
  const s = p.solicitud ?? {};
  if (d.brokerId) await brokerValido(d.brokerId);

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
      INSERT INTO crm_negocios_credito (
        ambiente, empresa_id, tipo, origen, origen_ref, monto_estimado, responsable_email, notas,
        producto, plazo_meses, destino, destino_detalle, garantia_tipo, garantia_detalle, garantia_valor, created_by, updated_by
      )
      VALUES (
        ${ambiente}, ${empresaId}, ${d.tipo}, ${d.origen}, ${p.origenRef ?? null}, ${s.montoEstimado ?? d.montoEstimado}, ${responsable}, ${d.notas},
        ${s.producto ?? null}, ${s.plazoMeses ?? null}, ${s.destino ?? null}, ${s.destinoDetalle ?? null},
        ${s.garantiaTipo ?? null}, ${s.garantiaDetalle ?? null}, ${s.garantiaValor ?? null}, ${p.actor}, ${p.actor}
      )
      RETURNING id
    `;
    await tx`INSERT INTO crm_negocio_etapas (negocio_id, de, a, actor) VALUES (${n.id}, NULL, 'prospecto', ${p.actor})`;
    if (d.brokerId) await tx`UPDATE crm_negocios_credito SET broker_id = ${d.brokerId} WHERE id = ${n.id}`;
    return { negocioId: n.id as string, empresaId, empresaNueva };
  });

  if (empresaNueva) await logAudit({ actorEmail: p.actor, action: "alta_empresa_prospecto", entityType: "empresa", entityId: empresaId, metadata: { negocioId } });
  await logAudit({
    actorEmail: p.actor,
    action: "alta_negocio",
    entityType: "negocio",
    entityId: negocioId,
    metadata: { empresaId, tipo: d.tipo, origen: d.origen, origenRef: p.origenRef ?? null, montoEstimado: s.montoEstimado ?? d.montoEstimado, responsable },
  });
  return negocioId;
}

/**
 * Mueve un negocio de etapa con las reglas de validarCambioEtapa y lo deja en
 * el historial. Al posponerlo crea la tarea para volver a contactarlo; al
 * sacarlo de pospuesto cancela esa tarea si sigue abierta.
 */
export async function cambiarEtapa(p: {
  id: string;
  etapa: string;
  entrada: { motivo?: string; recontactarEl?: string; motivoRechazo?: string };
  actor: string;
}): Promise<EtapaNegocio> {
  const hoy = fechaMexico();
  const r = await transaccion(async (tx) => {
    const [n] = await tx`
      SELECT n.etapa, n.empresa_id, n.responsable_email, n.producto, n.monto_estimado, n.plazo_meses, n.destino, n.garantia_tipo, e.rfc, e.nombre AS empresa,
             to_jsonb(n) AS j
      FROM crm_negocios_credito n JOIN crm_empresas e ON e.id = n.empresa_id
      WHERE n.id = ${p.id} AND n.ambiente = ${ambienteActual()} FOR UPDATE OF n
    `;
    if (!n) throw new NegocioError("Ese negocio no existe.");
    const v = validarCambioEtapa(n.etapa as EtapaNegocio, p.etapa, p.entrada, hoy, {
      producto: n.producto ?? null,
      montoEstimado: n.monto_estimado === null ? null : Number(n.monto_estimado),
      plazoMeses: n.plazo_meses === null ? null : Number(n.plazo_meses),
      destino: n.destino ?? null,
      garantiaTipo: n.garantia_tipo ?? null,
      rfcEmpresa: n.rfc ?? null,
    });
    if (!v.ok) throw new NegocioError(v.error);
    const d = v.datos;
    const cierre = d.etapa === "pospuesto" || d.etapa === "rechazado";
    await tx`
      UPDATE crm_negocios_credito
      SET etapa = ${d.etapa}, etapa_desde = now(), motivo_cierre = ${cierre ? d.motivo : null},
          recontactar_el = ${d.recontactarEl}, rechazo_motivo = ${d.rechazoMotivo}, rechazo_por = ${d.rechazoPor},
          updated_by = ${p.actor}, updated_at = now()
      WHERE id = ${p.id}
    `;
    await tx`INSERT INTO crm_negocio_etapas (negocio_id, de, a, motivo, actor) VALUES (${p.id}, ${n.etapa}, ${d.etapa}, ${d.motivo}, ${p.actor})`;
    const origen = `negocio:${p.id}`;
    if (n.etapa === "pospuesto") {
      await tx`
        UPDATE crm_tareas SET estado = 'cancelada', resultado = 'El negocio salió de pospuesto antes de la fecha.', cerrada_por = ${p.actor}, cerrada_at = now()
        WHERE origen = ${origen} AND estado = 'abierta' AND dedupe_key LIKE ${origen + ":recontactar:%"}
      `;
    }
    if (d.etapa === "pospuesto") {
      const dedupe = `${origen}:recontactar:${d.recontactarEl}`;
      await tx`
        INSERT INTO crm_tareas (empresa_id, titulo, descripcion, tipo, vence_el, responsable_email, origen, dedupe_key, created_by)
        SELECT ${n.empresa_id}, 'Volver a contactar: negocio pospuesto', ${d.motivo}, 'seguimiento', ${d.recontactarEl},
               ${n.responsable_email ?? p.actor}, ${origen}, ${dedupe}, ${p.actor}
        WHERE NOT EXISTS (SELECT 1 FROM crm_tareas WHERE dedupe_key = ${dedupe} AND estado = 'abierta')
      `;
    }
    // Dispersado de un broker: su colocación (comisiones y rankings), una sola vez.
    let colocacionId: string | null = null;
    const j = (n.j ?? {}) as Record<string, unknown>;
    if (d.etapa === "dispersado" && j.broker_id && !j.colocacion_id && n.monto_estimado !== null) {
      const [c] = await tx`
        INSERT INTO broker_colocaciones (broker_id, fecha, monto, comision_apertura_pct, referencia, created_by)
        VALUES (${j.broker_id as string}, ${hoy}, ${Number(n.monto_estimado)}, ${j.comision_apertura_pct === null || j.comision_apertura_pct === undefined ? null : Number(j.comision_apertura_pct)},
                ${`${n.empresa} (negocio de Originación)`.slice(0, 200)}, ${p.actor})
        RETURNING id
      `;
      colocacionId = String(c.id);
      await tx`UPDATE crm_negocios_credito SET colocacion_id = ${c.id} WHERE id = ${p.id}`;
    }
    return { de: n.etapa as EtapaNegocio, a: d.etapa, motivo: d.motivo, recontactarEl: d.recontactarEl, rechazoMotivo: d.rechazoMotivo, rechazoPor: d.rechazoPor, colocacionId };
  });
  await logAudit({ actorEmail: p.actor, action: "etapa_negocio", entityType: "negocio", entityId: p.id, metadata: r });
  return r.a;
}

/** Guarda los datos de la solicitud (producto, monto, plazo, destino y garantía). Regresa si cambió algo. */
export async function guardarSolicitud(p: { id: string; datos: DatosSolicitud; actor: string }): Promise<boolean> {
  const [antes] = await sql`
    SELECT producto, monto_estimado, plazo_meses, destino, destino_detalle, garantia_tipo, garantia_detalle, garantia_valor, to_jsonb(n) AS j
    FROM crm_negocios_credito n WHERE id = ${p.id} AND ambiente = ${ambienteActual()}
  `;
  if (!antes) throw new NegocioError("Ese negocio no existe.");
  const conComision = "comision_apertura_pct" in (antes.j ?? {});
  const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
  const d = p.datos;
  const pares: [string, unknown, unknown][] = [
    ["producto", antes.producto ?? null, d.producto],
    ["monto_estimado", num(antes.monto_estimado), d.montoEstimado],
    ["plazo_meses", num(antes.plazo_meses), d.plazoMeses],
    ["destino", antes.destino ?? null, d.destino],
    ["destino_detalle", antes.destino_detalle ?? null, d.destinoDetalle],
    ["garantia_tipo", antes.garantia_tipo ?? null, d.garantiaTipo],
    ["garantia_detalle", antes.garantia_detalle ?? null, d.garantiaDetalle],
    ["garantia_valor", num(antes.garantia_valor), d.garantiaValor],
    ...(conComision ? ([["comision_apertura_pct", num(antes.j.comision_apertura_pct), d.comisionAperturaPct]] as [string, unknown, unknown][]) : []),
  ];
  const cambios = Object.fromEntries(pares.filter(([, a, b]) => a !== b).map(([k, a, b]) => [k, { antes: a, despues: b }]));
  if (Object.keys(cambios).length === 0) return false;
  await sql`
    UPDATE crm_negocios_credito SET
      producto = ${d.producto}, monto_estimado = ${d.montoEstimado}, plazo_meses = ${d.plazoMeses}, destino = ${d.destino},
      destino_detalle = ${d.destinoDetalle}, garantia_tipo = ${d.garantiaTipo}, garantia_detalle = ${d.garantiaDetalle},
      garantia_valor = ${d.garantiaValor}, updated_by = ${p.actor}, updated_at = now()
    WHERE id = ${p.id}
  `;
  if (conComision) await sql`UPDATE crm_negocios_credito SET comision_apertura_pct = ${d.comisionAperturaPct} WHERE id = ${p.id}`;
  await logAudit({ actorEmail: p.actor, action: "solicitud_negocio", entityType: "negocio", entityId: p.id, metadata: { cambios } });
  return true;
}

/** Cambia responsable y notas. */
export async function editarNegocio(p: { id: string; responsableEmail: string | null; notas: string | null; actor: string }) {
  await usuarioActivo(p.responsableEmail);
  const [antes] = await sql`SELECT responsable_email, notas FROM crm_negocios_credito WHERE id = ${p.id} AND ambiente = ${ambienteActual()}`;
  if (!antes) throw new NegocioError("Ese negocio no existe.");
  const cambios: Record<string, { antes: unknown; despues: unknown } | true> = {};
  if ((antes.responsable_email ?? null) !== p.responsableEmail) cambios.responsable_email = { antes: antes.responsable_email ?? null, despues: p.responsableEmail };
  if ((antes.notas ?? null) !== p.notas) cambios.notas = true;
  if (Object.keys(cambios).length === 0) return false;
  await sql`
    UPDATE crm_negocios_credito SET responsable_email = ${p.responsableEmail}, notas = ${p.notas}, updated_by = ${p.actor}, updated_at = now()
    WHERE id = ${p.id}
  `;
  await logAudit({ actorEmail: p.actor, action: "editar_negocio", entityType: "negocio", entityId: p.id, metadata: { cambios } });
  return true;
}

/** El broker existe en el backoffice. */
async function brokerValido(brokerId: string) {
  const [b] = await sql`SELECT 1 FROM brokers WHERE id = ${brokerId}`;
  if (!b) throw new NegocioError("Ese broker no existe en el backoffice.");
}

/** Brokers para elegir en un negocio. */
export async function brokersParaNegocio(): Promise<{ id: string; nombre: string }[]> {
  const [t] = await sql`SELECT to_regclass('public.brokers') IS NOT NULL AS hay`;
  if (!t?.hay) return [];
  const rows = await sql`SELECT id, nombre FROM brokers ORDER BY nombre`;
  return rows.map((r) => ({ id: r.id as string, nombre: r.nombre as string }));
}

/** Cambia (o quita) el broker de un negocio. Un negocio ya dispersado con colocación no cambia de broker. */
export async function cambiarBroker(p: { id: string; brokerId: string | null; actor: string }): Promise<boolean> {
  if (p.brokerId) await brokerValido(p.brokerId);
  const [n] = await sql`SELECT to_jsonb(n) AS j FROM crm_negocios_credito n WHERE id = ${p.id} AND ambiente = ${ambienteActual()}`;
  if (!n) throw new NegocioError("Ese negocio no existe.");
  const j = n.j as Record<string, unknown>;
  if (!("broker_id" in j)) throw new NegocioError("Falta correr crm-schema.sql para ligar negocios a brokers.");
  if ((j.broker_id ?? null) === p.brokerId) return false;
  if (j.colocacion_id) throw new NegocioError("Ya se creó su colocación al dispersarlo; el broker ya no se cambia aquí.");
  await sql`
    UPDATE crm_negocios_credito SET broker_id = ${p.brokerId}, origen = CASE WHEN ${p.brokerId}::text IS NOT NULL THEN 'broker' ELSE origen END,
      updated_by = ${p.actor}, updated_at = now()
    WHERE id = ${p.id}
  `;
  await logAudit({ actorEmail: p.actor, action: "broker_negocio", entityType: "negocio", entityId: p.id, metadata: { antes: j.broker_id ?? null, despues: p.brokerId } });
  return true;
}

/** Lo que Finbra le dice al broker de esta solicitud; lo ve en su portal. */
export async function guardarMensajeBroker(p: { id: string; mensaje: string | null; actor: string }): Promise<void> {
  const r = await sql`
    UPDATE crm_negocios_credito SET mensaje_broker = ${p.mensaje}, updated_by = ${p.actor}, updated_at = now()
    WHERE id = ${p.id} AND ambiente = ${ambienteActual()} AND broker_id IS NOT NULL
    RETURNING id
  `;
  if (!r.length) throw new NegocioError("Ese negocio no es de un broker.");
  await logAudit({ actorEmail: p.actor, action: "mensaje_broker_negocio", entityType: "negocio", entityId: p.id });
}
