// Prueba del Listado Cobranza Personalizado de SIAC (2026-10-21 agregaron
// MontoSiguienteVencimiento). Hace UNA llamada con la foto de hoy y guarda la
// respuesta completa en col_siac_raw para revisar su formato. No toca la
// cartera: no escribe clientes, créditos ni fotos.

import { sql } from "@/lib/db";
import { logAudit } from "@/lib/db/audit";
import { SiacClient, SiacError, getSiacConfig } from "@/lib/siac/client";
import { siacCallRecorder } from "@/lib/collections/store";
import { fechaMexico } from "@/lib/collections/rules";
import { resumirPersonalizado, type ResumenPersonalizado } from "@/lib/collections/personalizado";

/** Registros por página que se piden: más que toda la cartera, para ver si sale en una sola llamada. */
export const POR_PAGINA_PRUEBA = 1000;

export async function probarListadoPersonalizado(p: { actor: string }): Promise<{ runId: number; filtro: "listado" | "anidado"; llamadas: number; resumen: ResumenPersonalizado }> {
  const config = getSiacConfig();
  if (!config) throw new Error("La conexión con SIAC no está configurada");
  const hoy = fechaMexico();
  const [run] = await sql`
    INSERT INTO col_sync_runs (ambiente, tipo, fecha_corte, disparado_por) VALUES (${config.ambiente}, 'consulta', ${hoy}, ${`prueba_personalizado:${p.actor}`}) RETURNING id
  `;
  const siac = new SiacClient(config, siacCallRecorder(run.id));
  const llamar = (filtro: "listado" | "anidado") => siac.listadoCobranzaPersonalizado({ corteFecha: hoy, pagina: 1, porPagina: POR_PAGINA_PRUEBA, filtro });

  let filtro: "listado" | "anidado" = "listado";
  let respuesta;
  try {
    try {
      respuesta = await llamar(filtro);
    } catch (e) {
      // El filtro solo está documentado en XML: si SIAC rechaza la forma del de ListadoCobranzaJSON, se prueba la anidada.
      if (!(e instanceof SiacError && /formato/i.test(e.message))) throw e;
      filtro = "anidado";
      respuesta = await llamar(filtro);
    }
  } catch (e) {
    await sql`UPDATE col_sync_runs SET status = 'error', error_detalle = ${(e as Error).message}, llamadas_siac = ${siac.llamadas}, finished_at = now() WHERE id = ${run.id}`;
    throw e;
  }

  const resumen = resumirPersonalizado(respuesta, "1109");
  await sql`
    UPDATE col_sync_runs SET status = 'completado', creditos_leidos = ${resumen.creditos}, llamadas_siac = ${siac.llamadas},
      duracion_siac_ms = ${siac.duracionMs}, finished_at = now()
    WHERE id = ${run.id}
  `;
  await logAudit({ actorEmail: p.actor, action: "cobranza_prueba_listado_personalizado", entityType: "col_sync_runs", entityId: String(run.id), metadata: { filtro, creditos: resumen.creditos, conMonto: resumen.conMontoSiguiente } });
  return { runId: run.id, filtro, llamadas: siac.llamadas, resumen };
}
