// Prueba de dos servicios de SIAC que todavía no usamos y que podrían traer a
// los ex clientes: ConsultarVistaCredito (lista paginada de créditos) y
// ConsultarClientes (con RFC). Hace UNA llamada a cada uno (en paralelo) y
// guarda las respuestas completas en col_siac_raw. No toca la cartera: no
// escribe clientes, créditos ni fotos.

import { sql } from "@/lib/db";
import { logAudit } from "@/lib/db/audit";
import { ambienteActual } from "@/lib/db/collections";
import { SiacClient, getSiacConfig } from "@/lib/siac/client";
import { siacCallRecorder } from "@/lib/collections/store";
import { fechaMexico } from "@/lib/collections/rules";
import { resumirRespuestaSiac, type ResumenServicio } from "@/lib/collections/prueba-cartera";

/** Registros que se piden en la página 1 de la vista de créditos: más que toda la cartera. */
export const POR_PAGINA_PRUEBA = 1000;

export type ResultadoServicio = { ok: true; resumen: ResumenServicio } | { ok: false; error: string };

export async function probarServiciosCartera(p: { actor: string }): Promise<{ runId: number; llamadas: number; vista: ResultadoServicio; clientes: ResultadoServicio }> {
  const config = getSiacConfig();
  if (!config) throw new Error("La conexión con SIAC no está configurada");
  const ambiente = ambienteActual();
  const [run] = await sql`
    INSERT INTO col_sync_runs (ambiente, tipo, fecha_corte, disparado_por)
    VALUES (${config.ambiente}, 'consulta', ${fechaMexico()}, ${`prueba_cartera:${p.actor}`})
    RETURNING id
  `;
  const siac = new SiacClient(config, siacCallRecorder(run.id));

  const [creditos, clientes] = await Promise.all([
    sql`SELECT no_credito FROM col_credits WHERE ambiente = ${ambiente} AND en_listado`,
    sql`SELECT numero_cliente FROM col_clients WHERE ambiente = ${ambiente}`,
  ]);
  const conocidos = {
    creditosVigentes: new Set(creditos.map((r) => r.no_credito as string)),
    clientes: new Set(clientes.map((r) => r.numero_cliente as string)),
  };

  const resultado = (r: PromiseSettledResult<unknown>): ResultadoServicio =>
    r.status === "fulfilled" ? { ok: true, resumen: resumirRespuestaSiac(r.value, conocidos) } : { ok: false, error: (r.reason as Error)?.message ?? String(r.reason) };
  const [vista, cli] = await Promise.allSettled([
    siac.consultarVistaCredito({ porPagina: POR_PAGINA_PRUEBA, pagina: 1 }),
    siac.consultarClientes(),
  ]);
  const r = { vista: resultado(vista), clientes: resultado(cli) };

  const errores = [r.vista, r.clientes].filter((x): x is { ok: false; error: string } => !x.ok).map((x) => x.error);
  await sql`
    UPDATE col_sync_runs SET
      status = ${errores.length === 2 ? "error" : "completado"},
      creditos_leidos = ${r.vista.ok ? r.vista.resumen.registros : 0},
      clientes_leidos = ${r.clientes.ok ? r.clientes.resumen.registros : 0},
      llamadas_siac = ${siac.llamadas}, duracion_siac_ms = ${siac.duracionMs},
      error_detalle = ${errores.length ? errores.join("\n") : null},
      finished_at = now()
    WHERE id = ${run.id}
  `;
  await logAudit({
    actorEmail: p.actor,
    action: "cobranza_prueba_servicios_cartera",
    entityType: "col_sync_runs",
    entityId: String(run.id),
    metadata: {
      vista: r.vista.ok ? { registros: r.vista.resumen.registros, fuera: r.vista.resumen.creditosFueraDelListado } : { error: r.vista.error },
      clientes: r.clientes.ok ? { registros: r.clientes.resumen.registros, conRfc: r.clientes.resumen.conRfc } : { error: r.clientes.error },
    },
  });
  return { runId: run.id, llamadas: siac.llamadas, ...r };
}
