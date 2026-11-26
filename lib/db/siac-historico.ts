// Créditos históricos de SIAC (crm_creditos_historicos): se suben del Excel
// «Estado de Clientes» en Negocios → Por ligar con SIAC. El navegador lee el
// Excel y manda solo las columnas que hacen falta (lib/clientes/siac-historico.ts).
// Volver a subirlo actualiza los que ya estaban. Después se marca cuáles
// siguen en cobranza (credit_id), para no ofrecer el mismo crédito dos veces.

import { sql } from "@/lib/db";
import { logAudit } from "@/lib/db/audit";
import { ambienteActual } from "@/lib/db/collections";
import { NegocioError } from "@/lib/db/negocios";
import { hayHistoricos } from "@/lib/db/siac-liga";
import type { CreditoHistorico } from "@/lib/clientes/siac-historico";

export interface ResultadoHistoricos {
  nuevos: number;
  actualizados: number;
  /** De los subidos, cuántos siguen en el listado de cobranza. */
  enCobranza: number;
  /** Cuántos quedaron para ligar (no están en cobranza ni ligados a un negocio). */
  libres: number;
}

/** Cuántos históricos hay y la fecha de la última subida; null si falta la tabla. */
export async function resumenHistoricos(): Promise<{ total: number; ultimaVez: string | null } | null> {
  if (!(await hayHistoricos())) return null;
  const [r] = await sql`
    SELECT count(*)::int AS total, max(updated_at) AS ultima FROM crm_creditos_historicos WHERE ambiente = ${ambienteActual()}
  `;
  return { total: r.total as number, ultimaVez: r.ultima ? new Date(r.ultima as string).toISOString() : null };
}

export async function importarCreditosHistoricos(p: { creditos: CreditoHistorico[]; actor: string }): Promise<ResultadoHistoricos> {
  if (!(await hayHistoricos())) throw new NegocioError("Falta correr crm-schema.sql (y security.sql) para guardar los créditos históricos.");
  const amb = ambienteActual();
  const ya = new Set(
    (await sql`SELECT no_credito FROM crm_creditos_historicos WHERE ambiente = ${amb}`).map((r) => r.no_credito as string),
  );
  const filas = p.creditos.map((c) => ({
    ambiente: amb,
    no_credito: c.noCredito,
    numero_cliente: c.numeroCliente,
    nombre: c.nombre,
    rfc: c.rfc,
    personalidad: c.personalidad,
    tipo_contrato: c.tipoContrato,
    monto: c.monto,
    fecha_otorgamiento: c.otorgado,
    fecha_vencimiento: c.vence,
    fecha_ultimo_pago: c.ultimoPago,
    estado: c.estado,
    importado_por: p.actor,
  }));
  for (let i = 0; i < filas.length; i += 500) {
    await sql`
      INSERT INTO crm_creditos_historicos ${sql(filas.slice(i, i + 500))}
      ON CONFLICT (ambiente, no_credito) DO UPDATE SET
        numero_cliente = EXCLUDED.numero_cliente, nombre = EXCLUDED.nombre, rfc = EXCLUDED.rfc, personalidad = EXCLUDED.personalidad,
        tipo_contrato = EXCLUDED.tipo_contrato, monto = EXCLUDED.monto, fecha_otorgamiento = EXCLUDED.fecha_otorgamiento,
        fecha_vencimiento = EXCLUDED.fecha_vencimiento, fecha_ultimo_pago = EXCLUDED.fecha_ultimo_pago, estado = EXCLUDED.estado,
        updated_at = now()
    `;
  }
  // El mismo crédito en cobranza: por número, o por cliente y fecha de ministración.
  await sql`
    UPDATE crm_creditos_historicos h SET credit_id = (
      SELECT cr.id FROM col_credits cr
      WHERE cr.ambiente = h.ambiente
        AND (upper(regexp_replace(trim(cr.no_credito), '[[:space:]]+', ' ', 'g')) = h.no_credito
             OR (cr.numero_cliente = h.numero_cliente AND cr.fecha_ministracion = h.fecha_otorgamiento))
      ORDER BY (upper(regexp_replace(trim(cr.no_credito), '[[:space:]]+', ' ', 'g')) = h.no_credito) DESC
      LIMIT 1
    )
    WHERE h.ambiente = ${amb}
  `;
  const [c] = await sql`
    SELECT count(*) FILTER (WHERE credit_id IS NOT NULL)::int AS en_cobranza,
           count(*) FILTER (WHERE credit_id IS NULL AND NOT EXISTS (SELECT 1 FROM crm_negocios_credito x WHERE x.credito_historico_id = h.id))::int AS libres
    FROM crm_creditos_historicos h WHERE h.ambiente = ${amb} AND h.no_credito = ANY(${p.creditos.map((x) => x.noCredito)}::text[])
  `;
  const nuevos = p.creditos.filter((x) => !ya.has(x.noCredito)).length;
  const r: ResultadoHistoricos = { nuevos, actualizados: p.creditos.length - nuevos, enCobranza: c.en_cobranza as number, libres: c.libres as number };
  await logAudit({ actorEmail: p.actor, action: "importar_creditos_historicos", entityType: "credito_historico", metadata: { ...r } });
  return r;
}
