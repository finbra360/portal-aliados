// Importa el historial de negocios ganados de HubSpot (un CSV revisado por una
// persona) a crm_empresas y crm_negocios. Ver lib/clientes/importar-hubspot.ts.

import { sql, transaccion, type Tx } from "@/lib/db";
import { ambienteActual } from "@/lib/db/collections";
import { leerNegocios, planearImportacion, type EmpresaExistente, type PlanEmpresa } from "@/lib/clientes/importar-hubspot";

async function existentes(q: typeof sql | Tx): Promise<EmpresaExistente[]> {
  const rows = await q`
    SELECT e.id, e.nombre, e.razon_social, e.hubspot_company_id,
           coalesce(array_agg(c.numero_cliente) FILTER (WHERE c.id IS NOT NULL), '{}') AS numeros
    FROM crm_empresas e LEFT JOIN col_clients c ON c.empresa_id = e.id
    WHERE e.ambiente = ${ambienteActual()}
    GROUP BY e.id
  `;
  return rows.map((r) => ({
    empresaId: r.id as string,
    nombre: r.nombre as string,
    razonSocial: (r.razon_social as string) ?? null,
    hubspotCompanyId: (r.hubspot_company_id as string) ?? null,
    numerosCliente: r.numeros as string[],
  }));
}

export type VistaPreviaHubspot = { plan: PlanEmpresa[]; errores: { fila: number; error: string }[] };

export async function previsualizarHubspot(texto: string): Promise<VistaPreviaHubspot | { error: string }> {
  const leido = leerNegocios(texto);
  if ("error" in leido) return leido;
  return { plan: planearImportacion(leido.filas, await existentes(sql)), errores: leido.errores };
}

/**
 * Importa todo en una transacción. Los grupos con error y las filas con error
 * se omiten. Volver a importar el mismo archivo no duplica: los negocios se
 * actualizan por su ID de HubSpot y las empresas ya ligadas se reconocen.
 */
export async function importarHubspot(texto: string, actor: string) {
  const leido = leerNegocios(texto);
  if ("error" in leido) throw new Error(leido.error);
  const ambiente = ambienteActual();

  return transaccion(async (tx) => {
    const plan = planearImportacion(leido.filas, await existentes(tx));
    const [omision] = await tx`
      SELECT a.email FROM crm_settings s JOIN admin_users a ON a.email = s.value->>'email' AND a.activo
      WHERE s.key = 'ejecutivo_por_omision'
    `;
    const r = { empresasNuevas: 0, empresasLigadas: 0, negocios: 0, gruposOmitidos: 0, filasOmitidas: leido.errores.length };

    for (const p of plan) {
      if (p.destino.tipo === "error") {
        r.gruposOmitidos++;
        continue;
      }
      // El ID de HubSpot solo se guarda si ninguna otra empresa lo tiene.
      const [ocupado] = p.hubspotEmpresaId
        ? await tx`SELECT id FROM crm_empresas WHERE ambiente = ${ambiente} AND hubspot_company_id = ${p.hubspotEmpresaId}`
        : [];
      let empresaId: string;
      if (p.destino.tipo === "nueva") {
        const [e] = await tx`
          INSERT INTO crm_empresas (ambiente, nombre, razon_social, industria, sitio_web, origen, hubspot_company_id, ejecutivo_email, created_by)
          VALUES (${ambiente}, ${p.nombre}, ${p.nombre}, ${p.industria}, ${p.sitioWeb}, 'hubspot', ${ocupado ? null : p.hubspotEmpresaId}, ${omision?.email ?? null}, ${actor})
          RETURNING id
        `;
        empresaId = e.id;
        r.empresasNuevas++;
      } else {
        empresaId = p.destino.empresaId;
        await tx`
          UPDATE crm_empresas SET
            hubspot_company_id = coalesce(hubspot_company_id, ${ocupado && ocupado.id !== empresaId ? null : p.hubspotEmpresaId}),
            industria = coalesce(industria, ${p.industria}),
            sitio_web = coalesce(sitio_web, ${p.sitioWeb}),
            updated_by = ${actor}, updated_at = now()
          WHERE id = ${empresaId}
        `;
        r.empresasLigadas++;
      }
      for (const n of p.negocios) {
        await tx`
          INSERT INTO crm_negocios (empresa_id, origen, hubspot_deal_id, nombre, pipeline, etapa, producto, monto, fecha_cierre, ganado, created_by)
          VALUES (${empresaId}, 'hubspot', ${n.dealId}, ${n.negocio}, ${n.pipeline}, ${n.etapa}, ${n.producto}, ${n.monto}, ${n.fechaCierre}, true, ${actor})
          ON CONFLICT (hubspot_deal_id) DO UPDATE SET
            empresa_id = EXCLUDED.empresa_id, nombre = EXCLUDED.nombre, pipeline = EXCLUDED.pipeline, etapa = EXCLUDED.etapa,
            producto = EXCLUDED.producto, monto = EXCLUDED.monto, fecha_cierre = EXCLUDED.fecha_cierre, updated_at = now()
        `;
        r.negocios++;
      }
    }

    // En la misma transacción: la bitácora queda solo si la importación se guardó.
    await tx`
      INSERT INTO audit_log (actor_email, action, entity_type, metadata)
      VALUES (${actor}, 'importar_hubspot', 'empresa', ${JSON.stringify(r)}::text::jsonb)
    `;
    return r;
  });
}
