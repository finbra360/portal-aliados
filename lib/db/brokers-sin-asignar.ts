// «Brokers sin asignar»: los negocios de origen broker sin broker, con la pista
// para sugerirlo (lib/clientes/brokers-sin-asignar.ts). Se asignan con
// cambiarBroker, igual que desde la ficha.

import { sql } from "@/lib/db";
import { ambienteActual } from "@/lib/db/collections";
import { operacionesSonNegocios } from "@/lib/db/operations";
import { brokersParaNegocio } from "@/lib/db/negocios";
import { pistasDeBroker, type Pista } from "@/lib/clientes/brokers-sin-asignar";
import type { EtapaNegocio } from "@/lib/clientes/negocios";

export interface RenglonSinBroker {
  id: string;
  empresaId: string;
  empresa: string;
  etapa: EtapaNegocio;
  monto: number | null;
  /** Fecha de alta (YYYY-MM-DD, hora de México). */
  creado: string;
  pistas: Pista[];
}

export interface BrokersSinAsignar {
  renglones: RenglonSinBroker[];
  brokers: { id: string; nombre: string }[];
}

/** null si la base todavía no liga negocios con brokers (falta crm-schema.sql). */
export async function getBrokersSinAsignar(): Promise<BrokersSinAsignar | null> {
  if (!(await operacionesSonNegocios())) return null;
  const amb = ambienteActual();
  const [negocios, colocaciones, deEmpresas, brokers] = await Promise.all([
    sql`
      SELECT n.id, n.empresa_id, e.nombre AS empresa, e.razon_social, n.etapa, n.monto_estimado,
             to_char(n.created_at AT TIME ZONE 'America/Mexico_City', 'YYYY-MM-DD') AS creado
      FROM crm_negocios_credito n JOIN crm_empresas e ON e.id = n.empresa_id
      WHERE n.ambiente = ${amb} AND n.origen = 'broker' AND n.broker_id IS NULL
      ORDER BY n.created_at DESC
    `,
    sql`
      SELECT broker_id, referencia, fecha::text AS fecha FROM broker_colocaciones
      WHERE referencia IS NOT NULL AND length(trim(referencia)) > 0
    `,
    sql`SELECT DISTINCT empresa_id, broker_id FROM crm_negocios_credito WHERE ambiente = ${amb} AND broker_id IS NOT NULL`,
    brokersParaNegocio(),
  ]);
  const col = colocaciones.map((c) => ({ brokerId: c.broker_id as string, referencia: c.referencia as string, fecha: c.fecha as string }));
  const emp = deEmpresas.map((d) => ({ empresaId: d.empresa_id as string, brokerId: d.broker_id as string }));
  const renglones = negocios.map((n) => {
    const base = { id: n.id as string, empresaId: n.empresa_id as string, empresa: n.empresa as string, razonSocial: (n.razon_social as string) ?? null };
    return {
      id: base.id,
      empresaId: base.empresaId,
      empresa: base.empresa,
      etapa: n.etapa as EtapaNegocio,
      monto: n.monto_estimado === null ? null : Number(n.monto_estimado),
      creado: n.creado as string,
      pistas: pistasDeBroker(base, col, emp),
    };
  });
  return { renglones, brokers };
}
