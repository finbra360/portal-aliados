// «Brokers sin asignar»: los negocios de origen broker sin broker y las
// renovaciones sin broker que tienen pista de uno, con la pista para sugerirlo
// (lib/clientes/brokers-sin-asignar.ts). Se asignan con cambiarBroker, igual
// que desde la ficha. Las renovaciones que el equipo marca como «No es de
// broker» se guardan en crm_settings «renovaciones_sin_broker».

import { sql } from "@/lib/db";
import { logAudit } from "@/lib/db/audit";
import { ambienteActual } from "@/lib/db/collections";
import { operacionesSonNegocios } from "@/lib/db/operations";
import { NegocioError, brokersParaNegocio } from "@/lib/db/negocios";
import { enLaLista, pistasDeBroker, type Pista } from "@/lib/clientes/brokers-sin-asignar";
import type { EtapaNegocio } from "@/lib/clientes/negocios";

export interface RenglonSinBroker {
  id: string;
  empresaId: string;
  empresa: string;
  etapa: EtapaNegocio;
  /** Renovación con pista de broker (las de origen broker van siempre). */
  renovacion: boolean;
  monto: number | null;
  /** Fecha de alta (YYYY-MM-DD, hora de México). */
  creado: string;
  pistas: Pista[];
}

export interface BrokersSinAsignar {
  renglones: RenglonSinBroker[];
  brokers: { id: string; nombre: string }[];
}

const CLAVE_DESCARTADAS = "renovaciones_sin_broker";

/** Renovaciones que el equipo ya revisó y no son de ningún broker. */
async function descartadas(): Promise<Set<string>> {
  const [r] = await sql`SELECT value FROM crm_settings WHERE key = ${CLAVE_DESCARTADAS}`;
  const ids = (r?.value as { ids?: unknown })?.ids;
  return new Set(Array.isArray(ids) ? ids.filter((x): x is string => typeof x === "string") : []);
}

/** null si la base todavía no liga negocios con brokers (falta crm-schema.sql). */
export async function getBrokersSinAsignar(): Promise<BrokersSinAsignar | null> {
  if (!(await operacionesSonNegocios())) return null;
  const amb = ambienteActual();
  const [negocios, colocaciones, deEmpresas, brokers, fuera] = await Promise.all([
    sql`
      SELECT n.id, n.empresa_id, e.nombre AS empresa, e.razon_social, n.etapa, n.origen, n.monto_estimado,
             to_char(n.created_at AT TIME ZONE 'America/Mexico_City', 'YYYY-MM-DD') AS creado
      FROM crm_negocios_credito n JOIN crm_empresas e ON e.id = n.empresa_id
      WHERE n.ambiente = ${amb} AND n.origen IN ('broker', 'renovacion') AND n.broker_id IS NULL
      ORDER BY n.created_at DESC
    `,
    sql`
      SELECT broker_id, referencia, fecha::text AS fecha FROM broker_colocaciones
      WHERE referencia IS NOT NULL AND length(trim(referencia)) > 0
    `,
    sql`SELECT DISTINCT empresa_id, broker_id FROM crm_negocios_credito WHERE ambiente = ${amb} AND broker_id IS NOT NULL`,
    brokersParaNegocio(),
    descartadas(),
  ]);
  const col = colocaciones.map((c) => ({ brokerId: c.broker_id as string, referencia: c.referencia as string, fecha: c.fecha as string }));
  const emp = deEmpresas.map((d) => ({ empresaId: d.empresa_id as string, brokerId: d.broker_id as string }));
  const renglones = negocios
    .map((n) => {
      const base = { id: n.id as string, empresaId: n.empresa_id as string, empresa: n.empresa as string, razonSocial: (n.razon_social as string) ?? null };
      return {
        id: base.id,
        empresaId: base.empresaId,
        empresa: base.empresa,
        etapa: n.etapa as EtapaNegocio,
        renovacion: n.origen === "renovacion",
        monto: n.monto_estimado === null ? null : Number(n.monto_estimado),
        creado: n.creado as string,
        pistas: pistasDeBroker(base, col, emp),
      };
    })
    .filter((r) => enLaLista({ renovacion: r.renovacion, pistas: r.pistas, descartada: fuera.has(r.id) }));
  return { renglones, brokers };
}

/** «No es de broker»: la renovación ya no sale en «Brokers sin asignar». */
export async function marcarRenovacionSinBroker(p: { id: string; actor: string }): Promise<void> {
  const [n] = await sql`SELECT origen FROM crm_negocios_credito WHERE id = ${p.id} AND ambiente = ${ambienteActual()}`;
  if (!n) throw new NegocioError("Ese negocio no existe.");
  if (n.origen !== "renovacion") throw new NegocioError("Solo las renovaciones se marcan como «No es de broker»; a este cámbiale el origen en su ficha.");
  const ids = await descartadas();
  if (ids.has(p.id)) return;
  ids.add(p.id);
  await sql`
    INSERT INTO crm_settings (key, value, descripcion, updated_by, updated_at)
    VALUES (${CLAVE_DESCARTADAS}, ${JSON.stringify({ ids: [...ids] })}::text::jsonb,
            'Renovaciones que se revisaron en Negocios → Brokers sin asignar y no son de ningún broker.', ${p.actor}, now())
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()
  `;
  await logAudit({ actorEmail: p.actor, action: "renovacion_sin_broker", entityType: "negocio", entityId: p.id });
}
