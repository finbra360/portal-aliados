// Datos para las métricas del embudo de originación (lib/clientes/embudo.ts):
// los negocios del ambiente con su monto de referencia y todo su historial de
// etapas. Las columnas de O4–O6 se leen con to_jsonb para que funcione aunque
// falte correr el SQL más reciente.

import { sql } from "@/lib/db";
import { ambienteActual } from "@/lib/db/collections";
import { getAjustesPlaybooks } from "@/lib/db/playbooks";
import { fechaMexico } from "@/lib/collections/rules";
import { calcularEmbudo, type Embudo, type Periodo } from "@/lib/clientes/embudo";
import type { EtapaNegocio, OrigenNegocio } from "@/lib/clientes/negocios";

const numero = (v: unknown) => (v === null || v === undefined ? null : Number(v));

export async function getEmbudo(periodo: Periodo): Promise<Embudo & { diasAtorado: number; desde: string; hasta: string }> {
  const ambiente = ambienteActual();
  const hasta = new Date();
  const desde = new Date(hasta.getTime() - periodo * 86_400_000);
  const [negocios, cambios, brokers, [{ hayDecisiones }], ajustes] = await Promise.all([
    sql`
      SELECT n.id, e.nombre AS empresa, n.origen, COALESCE(a.nombre, n.responsable_email) AS responsable, n.created_at, n.etapa, n.etapa_desde,
             n.monto_estimado, to_jsonb(n) AS j
      FROM crm_negocios_credito n JOIN crm_empresas e ON e.id = n.empresa_id LEFT JOIN admin_users a ON a.email = n.responsable_email
      WHERE n.ambiente = ${ambiente}
    `,
    sql`
      SELECT h.negocio_id, h.de, h.a, h.ocurrido_at
      FROM crm_negocio_etapas h JOIN crm_negocios_credito n ON n.id = h.negocio_id
      WHERE n.ambiente = ${ambiente}
    `,
    sql`SELECT id, nombre FROM brokers`,
    sql`SELECT to_regclass('public.crm_negocio_decisiones') IS NOT NULL AS "hayDecisiones"`,
    getAjustesPlaybooks(),
  ]);
  const aprobado = new Map<string, number>();
  if (hayDecisiones) {
    const filas = await sql`
      SELECT DISTINCT ON (d.negocio_id) d.negocio_id, d.monto
      FROM crm_negocio_decisiones d JOIN crm_negocios_credito n ON n.id = d.negocio_id
      WHERE n.ambiente = ${ambiente} AND d.decision = 'aprobado'
      ORDER BY d.negocio_id, d.decidido_at DESC, d.id DESC
    `;
    for (const f of filas) aprobado.set(f.negocio_id as string, Number(f.monto));
  }
  const creditIds = negocios.map((n) => (n.j as Record<string, unknown>).credit_id as string | undefined).filter((x): x is string => !!x);
  const montoCredito = new Map<string, number>();
  if (creditIds.length) {
    for (const c of await sql`SELECT id, monto_credito FROM col_credits WHERE id IN ${sql(creditIds)}`) {
      if (c.monto_credito !== null) montoCredito.set(c.id as string, Number(c.monto_credito));
    }
  }
  const nombreBroker = new Map(brokers.map((b) => [b.id as string, b.nombre as string]));

  const r = calcularEmbudo({
    negocios: negocios.map((n) => {
      const j = n.j as Record<string, unknown>;
      const creditId = (j.credit_id as string) ?? null;
      return {
        id: n.id as string,
        empresa: n.empresa as string,
        origen: n.origen as OrigenNegocio,
        responsable: (n.responsable as string) ?? null,
        broker: j.broker_id ? (nombreBroker.get(j.broker_id as string) ?? (j.broker_id as string)) : null,
        creadoAt: (n.created_at as Date).toISOString(),
        etapa: n.etapa as EtapaNegocio,
        etapaDesde: (n.etapa_desde as Date).toISOString(),
        monto: (creditId ? montoCredito.get(creditId) : undefined) ?? aprobado.get(n.id as string) ?? numero(j.oferta_monto) ?? numero(n.monto_estimado),
      };
    }),
    cambios: cambios.map((c) => ({
      negocioId: c.negocio_id as string,
      de: (c.de as EtapaNegocio) ?? null,
      a: c.a as EtapaNegocio,
      ocurridoAt: (c.ocurrido_at as Date).toISOString(),
    })),
    desde: desde.toISOString(),
    hasta: hasta.toISOString(),
    hoy: fechaMexico(),
    diasAtorado: ajustes.estancadoDias,
  });
  return { ...r, diasAtorado: ajustes.estancadoDias, desde: desde.toISOString(), hasta: hasta.toISOString() };
}
