import { sql } from "@/lib/db";
import { SiacClient, getSiacConfig, type SiacAmbiente } from "@/lib/siac/client";
import { toSnapshotValues, type SnapshotValues } from "@/lib/siac/parse";
import { reconstruct } from "./reconstruct";
import { addDays, fechaMexico } from "./rules";
import {
  dayValues,
  insertEvent,
  loadDailyStates,
  siacCallRecorder,
  upsertSnapshot,
  type ActiveCredit,
} from "./store";

const CONCURRENCIA_SIAC = 5;
/** Después de este tiempo no se empiezan créditos nuevos; los que van a medias terminan. */
const PRESUPUESTO_MS = 150_000;

export interface BackfillResult {
  runId: number;
  ambiente: SiacAmbiente;
  status: "completado" | "parcial" | "error";
  procesados: { noControl: string; fotos: number; eventos: number; consultas: number }[];
  errores: string[];
  /** Créditos activos que siguen sin reconstruir. Se vuelve a llamar hasta que sea 0. */
  pendientes: number;
  llamadasSiac: number;
}

/**
 * Reconstrucción histórica de los créditos activos, desde su fecha de alta
 * hasta su última foto diaria (o hasta ayer, si todavía no tiene). Las fotos
 * diarias que ya existen se reusan sin volver a pedirlas, así que también se
 * rellenan los huecos largos que la foto diaria no pudo cubrir. Procesa los créditos que puede dentro de PRESUPUESTO_MS y deja el
 * resto para la siguiente llamada: cada crédito se guarda completo en una
 * sola transacción, así que un corte a medias no deja nada inconsistente.
 */
export async function runBackfill(opts: { disparadoPor: string; noControl?: string }): Promise<BackfillResult> {
  const config = getSiacConfig();
  if (!config) throw new Error("SIAC no está configurado (faltan variables SIAC_*)");
  const ambiente = config.ambiente;
  const ayer = addDays(fechaMexico(), -1);
  const inicio = Date.now();

  const [run] = await sql`
    INSERT INTO col_sync_runs (ambiente, tipo, disparado_por)
    VALUES (${ambiente}, 'reconstruccion', ${opts.disparadoPor})
    RETURNING id
  `;
  const runId = run.id as number;
  const siac = new SiacClient(config, siacCallRecorder(runId));
  const result: BackfillResult = { runId, ambiente, status: "completado", procesados: [], errores: [], pendientes: 0, llamadasSiac: 0 };

  const creditos = (await sql`
    SELECT id, client_id, id_cliente_siac, no_control, to_char(fecha_alta, 'YYYY-MM-DD') AS fecha_alta
    FROM col_credits
    WHERE ambiente = ${ambiente} AND estatus_siac = 'ACTIVO'
      AND (${opts.noControl ?? null}::text IS NULL AND reconstruido_at IS NULL OR no_control = ${opts.noControl ?? null})
    ORDER BY fecha_alta
  `) as unknown as ActiveCredit[];

  let i = 0;
  const worker = async () => {
    while (i < creditos.length && Date.now() - inicio < PRESUPUESTO_MS) {
      const cr = creditos[i++];
      try {
        result.procesados.push(await reconstructCredit(siac, runId, cr, ayer));
      } catch (e) {
        const mensaje = (e as Error).message;
        result.errores.push(`${cr.no_control}: ${mensaje}`);
        await sql`UPDATE col_credits SET reconstruccion_error = ${mensaje} WHERE id = ${cr.id}`;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCIA_SIAC, creditos.length) }, worker));

  const [{ n }] = await sql`
    SELECT count(*)::int AS n FROM col_credits
    WHERE ambiente = ${ambiente} AND estatus_siac = 'ACTIVO' AND reconstruido_at IS NULL
  `;
  result.pendientes = n;
  result.llamadasSiac = siac.llamadas;
  result.status = result.errores.length === 0 ? "completado" : result.procesados.length ? "parcial" : "error";

  await sql`
    UPDATE col_sync_runs SET
      status = ${result.status},
      creditos_leidos = ${result.procesados.length},
      snapshots_guardados = ${result.procesados.reduce((s, p) => s + p.fotos, 0)},
      llamadas_siac = ${result.llamadasSiac},
      errores = ${result.errores.length},
      error_detalle = ${result.errores.length ? result.errores.join("\n") : null},
      finished_at = now()
    WHERE id = ${runId}
  `;
  return result;
}

async function reconstructCredit(siac: SiacClient, runId: number, cr: ActiveCredit, ayer: string) {
  const diarias = await loadDailyStates(cr.id);
  const fin = diarias.at(-1)?.fechaCorte ?? ayer;
  if (fin < cr.fecha_alta) {
    await sql`UPDATE col_credits SET reconstruido_at = now(), reconstruccion_error = NULL WHERE id = ${cr.id}`;
    return { noControl: cr.no_control, fotos: 0, eventos: 0, consultas: 0 };
  }

  const completas = new Map<string, SnapshotValues>();
  const fetchDay = async (fecha: string) => {
    const values = toSnapshotValues(await siac.consultarSaldoCredito(cr.no_control, cr.id_cliente_siac, fecha));
    completas.set(fecha, values);
    return dayValues(fecha, values);
  };
  const r = await reconstruct(cr.fecha_alta, fin, fetchDay, diarias);
  const vencidoDesdeDiario = new Map(diarias.map((d) => [d.fechaCorte, d.vencidoDesde]));

  let eventos = 0;
  await sql.begin(async (tx) => {
    for (const estado of r.estados) {
      const values = completas.get(estado.fechaCorte);
      if (values) {
        await upsertSnapshot(tx, {
          creditId: cr.id,
          fechaCorte: estado.fechaCorte,
          origen: "reconstruccion",
          runId,
          values,
          vencidoDesde: estado.vencidoDesde,
        });
      } else if (vencidoDesdeDiario.get(estado.fechaCorte) !== estado.vencidoDesde) {
        // Foto diaria que no sabía desde cuándo venía el vencido.
        await tx`
          UPDATE col_balance_snapshots SET vencido_desde = ${estado.vencidoDesde}
          WHERE credit_id = ${cr.id} AND fecha_corte = ${estado.fechaCorte}
        `;
      }
    }
    // Eventos históricos al timeline, sin alertas: son cosas que ya pasaron.
    // Los que la foto diaria ya había registrado no se duplican.
    for (const ev of r.eventos) eventos += await insertEvent(tx, runId, cr, ev);
    await tx`UPDATE col_credits SET reconstruido_at = now(), reconstruccion_error = NULL WHERE id = ${cr.id}`;
  });

  return { noControl: cr.no_control, fotos: completas.size, eventos, consultas: r.consultadas.length };
}
