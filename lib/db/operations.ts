import { sql, transaccion } from "@/lib/db";
import { logAudit } from "./audit";
import type { OperationStatus } from "@/components/ui/StatusPill";
import { etapaParaBroker, historialParaBroker } from "@/lib/operaciones-seguimiento";

// Desde la fase O4 de originación las solicitudes de los brokers son negocios
// de crédito (crm_negocios_credito con broker_id) y la tabla operations queda
// solo como respaldo. Mientras no se corra crm-schema.sql, todo sigue leyendo
// operations como siempre: el portal del broker no se rompe en el cambio.

export interface Operation {
  /** Id del negocio (uuid) o, antes de la migración, de la operación (número). */
  id: string;
  brokerId: string;
  clienteReferencia: string;
  montoSolicitado: number;
  etapa: OperationStatus;
  notas: string | null;
  /** Lo que Finbra le dice al broker sobre esta solicitud (las notas internas no se muestran). */
  mensajeBroker: string | null;
  createdAt: string;
  updatedAt: string;
}

function mapRow(r: Record<string, unknown>): Operation {
  return {
    id: String(r.id),
    brokerId: r.broker_id as string,
    clienteReferencia: r.cliente_referencia as string,
    montoSolicitado: Number(r.monto_solicitado),
    etapa: r.etapa as OperationStatus,
    notas: (r.notas as string) ?? null,
    mensajeBroker: (r.mensaje_broker as string) ?? null,
    createdAt: (r.created_at as Date).toISOString(),
    updatedAt: (r.updated_at as Date).toISOString(),
  };
}

export interface OperationFilters {
  brokerId?: string;
  etapa?: OperationStatus;
}

/** Ya se corrió la migración de la fase O4: las solicitudes viven en los negocios. */
export async function operacionesSonNegocios(): Promise<boolean> {
  const [r] = await sql`
    SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'crm_negocios_credito' AND column_name = 'broker_id') AS si
  `;
  return !!r?.si;
}

const SELECT_NEGOCIO_BROKER = () => sql`
  SELECT n.id, n.broker_id, e.nombre AS cliente, n.monto_estimado, n.etapa, n.notas, n.mensaje_broker, n.created_at, n.etapa_desde,
         (SELECT h.de FROM crm_negocio_etapas h WHERE h.negocio_id = n.id AND h.a = 'pospuesto' ORDER BY h.ocurrido_at DESC, h.id DESC LIMIT 1) AS antes_de_pausa
  FROM crm_negocios_credito n JOIN crm_empresas e ON e.id = n.empresa_id
`;

function mapNegocio(r: Record<string, unknown>): Operation {
  return {
    id: r.id as string,
    brokerId: r.broker_id as string,
    clienteReferencia: r.cliente as string,
    montoSolicitado: r.monto_estimado === null ? 0 : Number(r.monto_estimado),
    etapa: etapaParaBroker(r.etapa as string, (r.antes_de_pausa as string) ?? null),
    notas: (r.notas as string) ?? null,
    mensajeBroker: (r.mensaje_broker as string) ?? null,
    createdAt: (r.created_at as Date).toISOString(),
    updatedAt: (r.etapa_desde as Date).toISOString(),
  };
}

export async function listOperations(filters: OperationFilters = {}): Promise<Operation[]> {
  if (await operacionesSonNegocios()) {
    const rows = await sql`
      ${SELECT_NEGOCIO_BROKER()}
      WHERE n.broker_id IS NOT NULL AND (${filters.brokerId ?? null}::text IS NULL OR n.broker_id = ${filters.brokerId ?? null})
      ORDER BY n.updated_at DESC
      LIMIT 500
    `;
    return rows.map(mapNegocio).filter((o) => !filters.etapa || o.etapa === filters.etapa);
  }
  const rows = await sql`
    SELECT * FROM operations
    WHERE (${filters.brokerId ?? null}::text IS NULL OR broker_id = ${filters.brokerId ?? null})
      AND (${filters.etapa ?? null}::text IS NULL OR etapa = ${filters.etapa ?? null})
    ORDER BY updated_at DESC
    LIMIT 500
  `;
  return rows.map(mapRow);
}

/** Solo si la solicitud es de ese broker: un broker no ve las de otro cambiando el número en la URL. */
/**
 * Solo si la solicitud es de ese broker: un broker no ve las de otro cambiando
 * el id en la URL. Acepta el id del negocio o el número de la operación vieja
 * (ligas guardadas de antes de la migración).
 */
export async function getOperationOfBroker(id: string, brokerId: string): Promise<Operation | null> {
  const numero = /^\d{1,9}$/.test(id) ? Number(id) : null;
  const uuid = /^[0-9a-f-]{36}$/i.test(id) ? id : null;
  if (await operacionesSonNegocios()) {
    const rows = uuid
      ? await sql`${SELECT_NEGOCIO_BROKER()} WHERE n.id = ${uuid} AND n.broker_id = ${brokerId}`
      : numero !== null
        ? await sql`${SELECT_NEGOCIO_BROKER()} WHERE n.origen_ref = ${"operacion:" + numero} AND n.broker_id = ${brokerId}`
        : [];
    return rows[0] ? mapNegocio(rows[0]) : null;
  }
  if (numero === null) return null;
  const rows = await sql`SELECT * FROM operations WHERE id = ${numero} AND broker_id = ${brokerId}`;
  return rows[0] ? mapRow(rows[0]) : null;
}

export async function listOperationHistory(operationId: string): Promise<{ etapa: OperationStatus; fecha: string }[]> {
  if (/^[0-9a-f-]{36}$/i.test(operationId)) {
    const cambios = await sql`SELECT de, a, ocurrido_at FROM crm_negocio_etapas WHERE negocio_id = ${operationId} ORDER BY ocurrido_at, id`;
    const historial = historialParaBroker(cambios.map((c) => ({ de: (c.de as string) ?? null, a: c.a as string, fecha: (c.ocurrido_at as Date).toISOString() })));
    // «Aprobada» no es una etapa del negocio: es la decisión del comité (fase O5).
    const [{ hay }] = await sql`SELECT to_regclass('public.crm_negocio_decisiones') IS NOT NULL AS hay`;
    if (hay) {
      const [d] = await sql`
        SELECT decidido_at FROM crm_negocio_decisiones WHERE negocio_id = ${operationId} AND decision = 'aprobado' ORDER BY decidido_at DESC, id DESC LIMIT 1
      `;
      if (d) historial.push({ etapa: "aprobada", fecha: (d.decidido_at as Date).toISOString() });
    }
    return historial;
  }
  const rows = await sql`
    SELECT etapa, created_at FROM operation_history WHERE operation_id = ${Number(operationId)} ORDER BY created_at, id
  `;
  return rows.map((r) => ({ etapa: r.etapa as OperationStatus, fecha: (r.created_at as Date).toISOString() }));
}

export async function setOperationBrokerMessage(params: { id: number; mensaje: string | null; actorEmail: string }): Promise<void> {
  const rows = await sql`
    UPDATE operations SET mensaje_broker = ${params.mensaje}, updated_at = now() WHERE id = ${params.id} RETURNING id
  `;
  if (!rows[0]) throw new Error("Operación no encontrada");
  await logAudit({
    actorEmail: params.actorEmail,
    action: "update_operation_message",
    entityType: "operation",
    entityId: String(params.id),
  });
}

export async function createOperation(params: {
  brokerId: string;
  clienteReferencia: string;
  montoSolicitado: number;
  notas?: string;
  actorEmail: string;
}): Promise<Operation> {
  const operation = await transaccion(async (tx) => {
    const rows = await tx`
      INSERT INTO operations (broker_id, cliente_referencia, monto_solicitado, notas)
      VALUES (${params.brokerId}, ${params.clienteReferencia}, ${params.montoSolicitado}, ${params.notas ?? null})
      RETURNING *
    `;
    await tx`INSERT INTO operation_history (operation_id, etapa) VALUES (${rows[0].id}, ${rows[0].etapa})`;
    return mapRow(rows[0]);
  });
  await logAudit({
    actorEmail: params.actorEmail,
    action: "create_operation",
    entityType: "operation",
    entityId: String(operation.id),
    metadata: { brokerId: params.brokerId, montoSolicitado: params.montoSolicitado },
  });
  return operation;
}

export async function updateOperationStage(params: {
  id: number;
  etapa: OperationStatus;
  actorEmail: string;
}): Promise<Operation> {
  const operation = await transaccion(async (tx) => {
    const antes = await tx`SELECT etapa FROM operations WHERE id = ${params.id} FOR UPDATE`;
    if (!antes[0]) {
      throw new Error("Operación no encontrada");
    }
    const rows = await tx`
      UPDATE operations SET etapa = ${params.etapa}, updated_at = now()
      WHERE id = ${params.id}
      RETURNING *
    `;
    // Elegir la misma etapa otra vez no es un paso nuevo.
    if (antes[0].etapa !== params.etapa) {
      await tx`INSERT INTO operation_history (operation_id, etapa) VALUES (${params.id}, ${params.etapa})`;
    }
    return mapRow(rows[0]);
  });
  await logAudit({
    actorEmail: params.actorEmail,
    action: "update_operation_stage",
    entityType: "operation",
    entityId: String(operation.id),
    metadata: { newEtapa: params.etapa },
  });
  return operation;
}

export async function countOperationsByStage(): Promise<Record<OperationStatus, number>> {
  const rows = (await operacionesSonNegocios())
    ? (await listOperations()).reduce<{ etapa: string; count: number }[]>((acc, o) => {
        const x = acc.find((a) => a.etapa === o.etapa);
        if (x) x.count++;
        else acc.push({ etapa: o.etapa, count: 1 });
        return acc;
      }, [])
    : await sql`SELECT etapa, COUNT(*)::int AS count FROM operations GROUP BY etapa`;
  const base: Record<string, number> = {
    recibida: 0,
    documentacion_pendiente: 0,
    en_analisis: 0,
    aprobada: 0,
    formalizacion: 0,
    fondeada: 0,
    rechazada: 0,
  };
  for (const r of rows) {
    base[r.etapa as string] = r.count as number;
  }
  return base as Record<OperationStatus, number>;
}
