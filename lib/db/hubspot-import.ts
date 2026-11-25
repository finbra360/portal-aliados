// Importar negocios de HubSpot (fase O7). Las reglas (leer el export,
// etapas, empresa y responsable) están en lib/clientes/hubspot-import.ts.
// Cada negocio se crea con crearNegocio y origen_ref 'hubspot:<id>': si ya
// existe, no se vuelve a crear. Luego se pone en su etapa, con la fecha de
// alta de HubSpot. Los cerrados (pospuesto, rechazado, dispersado) quedan con
// su fecha de cierre y sin efectos: no crean tareas ni colocaciones.

import { sql, transaccion } from "@/lib/db";
import { logAudit } from "@/lib/db/audit";
import { ambienteActual } from "@/lib/db/collections";
import { fechaMexico } from "@/lib/collections/rules";
import { crearNegocio, NegocioError } from "@/lib/db/negocios";
import { ETIQUETA_ETAPA } from "@/lib/clientes/negocios";
import { leerExport, planImportacion, type ColumnaFaltante, type ParaImportar } from "@/lib/clientes/hubspot-import";

/** Tope del archivo (lo que cabe en una acción del servidor). */
export const MAX_BYTES = 900_000;

async function contexto() {
  const ambiente = ambienteActual();
  const [importados, empresas, usuarios] = await Promise.all([
    sql`SELECT substring(origen_ref from 9) AS id FROM crm_negocios_credito WHERE ambiente = ${ambiente} AND origen_ref LIKE 'hubspot:%'`,
    sql`SELECT id, nombre, razon_social FROM crm_empresas WHERE ambiente = ${ambiente}`,
    sql`SELECT email, nombre FROM admin_users WHERE activo`,
  ]);
  return {
    hoy: fechaMexico(),
    importados: new Set(importados.map((r) => r.id as string)),
    empresas: empresas.map((e) => ({ id: e.id as string, nombre: e.nombre as string, razonSocial: (e.razon_social as string) ?? null })),
    usuarios: usuarios.map((u) => ({ email: u.email as string, nombre: u.nombre as string })),
  };
}

export type VistaPrevia = { ok: true; items: ParaImportar[]; faltan: ColumnaFaltante[]; excluidos: number } | { ok: false; error: string };

/** Lee el export y arma la vista previa (sin escribir nada). */
export async function vistaPreviaHubspot(texto: string): Promise<VistaPrevia> {
  const r = leerExport(texto);
  if (!r.ok) return r;
  const items = planImportacion(r.filas, await contexto());
  return { ok: true, items, faltan: r.faltan, excluidos: r.filas.length - items.length };
}

export interface ResultadoImportacion {
  creados: number;
  empresasNuevas: number;
  yaEstaban: number;
  conProblema: number;
}

/**
 * Importa los negocios elegidos (por ID de HubSpot). Vuelve a leer el archivo
 * en el servidor: no confía en lo que mandó el navegador más allá de los IDs.
 */
export async function importarDeHubspot(p: { texto: string; ids: string[]; actor: string }): Promise<ResultadoImportacion> {
  const r = leerExport(p.texto);
  if (!r.ok) throw new NegocioError(r.error);
  const elegidos = new Set(p.ids);
  const ctx = await contexto();
  const plan = planImportacion(r.filas, ctx).filter((x) => elegidos.has(x.fila.hubspotId));
  const res: ResultadoImportacion = { creados: 0, empresasNuevas: 0, yaEstaban: 0, conProblema: 0 };

  for (const x of plan) {
    if (x.yaImportado) {
      res.yaEstaban++;
      continue;
    }
    if (x.problema || !x.etapa) {
      res.conProblema++;
      continue;
    }
    const f = x.fila;
    const notas = [
      `Importado de HubSpot (negocio ${f.hubspotId}${f.nombre && f.nombre !== f.empresa ? `: ${f.nombre}` : ""}).`,
      `Etapa en HubSpot: ${f.etapaHubspot}.`,
      f.propietario ? `Dueño en HubSpot: ${f.propietario}.` : null,
      f.ultimaActividad ? `Última actividad en HubSpot: ${f.ultimaActividad}.` : null,
      f.cerradoEl && x.grupo !== "abierto" ? `Cerrado en HubSpot: ${f.cerradoEl}.` : null,
    ]
      .filter(Boolean)
      .join(" ");
    const id = await crearNegocio({
      datos: {
        empresa: x.empresa ? { id: x.empresa.id } : { nueva: { nombre: f.empresa, razonSocial: null, rfc: null } },
        contacto: null,
        tipo: x.tipo,
        origen: x.origen,
        montoEstimado: f.monto,
        responsableEmail: x.responsable?.email ?? null,
        notas,
        brokerId: null,
      },
      actor: p.actor,
      origenRef: `hubspot:${f.hubspotId}`,
      reusarEmpresa: true,
    });
    if (!x.empresa) res.empresasNuevas++;
    const creado = f.creadoEl ? `${f.creadoEl}T18:00:00Z` : null;
    // Un cerrado queda en su etapa desde la fecha de cierre de HubSpot (para las métricas); un abierto, desde hoy.
    const cerrado = x.grupo !== "abierto";
    const desde = cerrado ? (f.cerradoEl ? `${f.cerradoEl}T18:00:00Z` : creado) : null;
    const motivoCierre =
      x.etapa === "pospuesto" ? `Seguimiento a futuro en HubSpot${f.motivoPerdida ? `: ${f.motivoPerdida}` : ""}`
      : x.etapa === "rechazado" ? `Rechazado en HubSpot${f.motivoPerdida ? `: ${f.motivoPerdida}` : ""}`
      : null;
    await transaccion(async (tx) => {
      const [n] = await tx`SELECT etapa FROM crm_negocios_credito WHERE id = ${id} FOR UPDATE`;
      if (creado) {
        await tx`UPDATE crm_negocios_credito SET created_at = ${creado}::timestamptz WHERE id = ${id}`;
        await tx`UPDATE crm_negocio_etapas SET ocurrido_at = ${creado}::timestamptz WHERE negocio_id = ${id} AND de IS NULL`;
      }
      if (n.etapa === "prospecto" && x.etapa !== "prospecto") {
        await tx`
          UPDATE crm_negocios_credito
          SET etapa = ${x.etapa}, etapa_desde = COALESCE(${desde}::timestamptz, now()), motivo_cierre = ${motivoCierre}
          WHERE id = ${id}
        `;
        await tx`
          INSERT INTO crm_negocio_etapas (negocio_id, de, a, motivo, actor, ocurrido_at)
          VALUES (${id}, 'prospecto', ${x.etapa}, ${`Importado de HubSpot (etapa «${f.etapaHubspot}» → ${ETIQUETA_ETAPA[x.etapa!]})${motivoCierre ? `. ${motivoCierre}` : ""}`.slice(0, 1000)},
                  ${p.actor}, COALESCE(${desde}::timestamptz, now()))
        `;
      }
    });
    res.creados++;
  }
  await logAudit({ actorEmail: p.actor, action: "importar_hubspot", entityType: "negocio", metadata: { ...res, elegidos: p.ids.length } });
  return res;
}
