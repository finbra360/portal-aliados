// Empresas (crm_empresas): una por razón social. Ver lib/db/crm-schema.sql.

import type { Tx } from "@/lib/db";

/**
 * Crea la empresa de cada cliente de SIAC del ambiente que todavía no tiene una
 * y lo liga (col_clients.empresa_id). Corre dentro de la transacción de la foto
 * diaria, así que un cliente nuevo nunca queda sin empresa. Es idempotente:
 * `creada_desde_cliente` es única, y los clientes ya ligados no se tocan.
 *
 * Si crm-schema.sql todavía no se ha corrido en la base, no hace nada: la foto
 * diaria de cobranza no debe fallar por el módulo de clientes.
 *
 * Regresa cuántos clientes quedaron ligados a una empresa nueva.
 */
export async function vincularEmpresasNuevas(tx: Tx, ambiente: "pruebas" | "produccion"): Promise<number> {
  const [existe] = await tx`SELECT to_regclass('public.crm_empresas') IS NOT NULL AS ok`;
  if (!existe?.ok) return 0;

  await tx`
    INSERT INTO crm_empresas (ambiente, nombre, razon_social, origen, creada_desde_cliente, ejecutivo_email, created_by)
    SELECT c.ambiente, c.nombre, c.nombre, 'siac', c.id,
           (SELECT a.email FROM crm_settings s JOIN admin_users a ON a.email = s.value->>'email' AND a.activo WHERE s.key = 'ejecutivo_por_omision'),
           'sistema'
    FROM col_clients c
    WHERE c.ambiente = ${ambiente} AND c.empresa_id IS NULL
    ON CONFLICT (creada_desde_cliente) DO NOTHING
  `;
  const ligados = await tx`
    UPDATE col_clients c SET empresa_id = e.id
    FROM crm_empresas e
    WHERE e.creada_desde_cliente = c.id AND c.ambiente = ${ambiente} AND c.empresa_id IS NULL
    RETURNING c.id
  `;
  return ligados.length;
}
