import { sql } from "@/lib/db";
import { SiacClient, SiacError, getSiacConfig, type SiacAmbiente } from "@/lib/siac/client";
import { parsePagos } from "@/lib/siac/parse";
import { getSetting, peso, siacCallRecorder } from "./store";

// ConsultarPagos es un servicio por crédito. SIAC pidió no hacer cargas
// masivas con servicios individuales, así que se llama solo:
// - desde la foto diaria, para los créditos con un pago nuevo (con tope diario);
// - en la carga inicial, una vez por crédito, cuando SIAC la autorice;
// - bajo demanda, desde el expediente.

const PAUSA_ENTRE_LLAMADAS_MS = 1000;
const PRESUPUESTO_CARGA_INICIAL_MS = 60_000;

export const pausa = () => new Promise((r) => setTimeout(r, PAUSA_ENTRE_LLAMADAS_MS));

export interface PaymentCredit {
  id: string;
  clientId: string;
  numeroCliente: string;
  noCredito: string;
}

/** Algunos servicios de SIAC contestan "sin registros" como error de negocio. */
const sinRegistros = (e: unknown) => e instanceof SiacError && !!e.detalle && /no se encontr|sin pagos|no existen|no hay/i.test(e.detalle);

/**
 * Trae la historia de pagos de UN crédito y guarda los que no teníamos. Cada
 * pago nuevo queda en el timeline con su monto y su fecha de aplicación.
 * Regresa cuántos pagos eran nuevos.
 */
export async function fetchAndStorePayments(siac: SiacClient, runId: number, cr: PaymentCredit): Promise<{ nuevos: number; total: number }> {
  let pagos: ReturnType<typeof parsePagos>;
  try {
    pagos = parsePagos(await siac.consultarPagos(cr.numeroCliente, cr.noCredito));
  } catch (e) {
    if (!sinRegistros(e)) throw e;
    pagos = [];
  }

  let nuevos = 0;
  await sql.begin(async (tx) => {
    for (const p of pagos) {
      const [row] = await tx`
        INSERT INTO col_payments (credit_id, fecha_aplicacion, fecha_captura, monto, no_pago, concepto, comentario, huella, ocurrencia, sync_run_id, raw)
        VALUES (${cr.id}, ${p.fechaAplicacion}, ${p.fechaCaptura}, ${p.monto}, ${p.noPago}, ${p.concepto}, ${p.comentario},
                ${p.huella}, ${p.ocurrencia}, ${runId}, ${JSON.stringify(p.raw)}::jsonb)
        ON CONFLICT (credit_id, huella, ocurrencia) DO NOTHING
        RETURNING id
      `;
      if (!row) continue;
      nuevos++;
      await tx`
        INSERT INTO col_activities (client_id, credit_id, tipo, descripcion, metadata, actor, ocurrido_at)
        VALUES (${cr.clientId}, ${cr.id}, 'pago_registrado',
                ${`Pago de ${peso(p.monto)} aplicado al crédito ${cr.noCredito}${p.concepto ? ` (${p.concepto.toLowerCase()})` : ""}`},
                ${JSON.stringify({ paymentId: row.id, fechaCaptura: p.fechaCaptura })}::jsonb, 'sistema',
                (${p.fechaAplicacion}::date + time '12:00') AT TIME ZONE 'America/Mexico_City')
      `;
    }
    await tx`UPDATE col_credits SET pagos_sincronizados_at = now() WHERE id = ${cr.id}`;
  });
  return { nuevos, total: pagos.length };
}

export interface InitialLoadResult {
  runId: number | null;
  ambiente: SiacAmbiente;
  status: "completado" | "no_autorizada" | "error";
  procesados: { noCredito: string; pagos: number }[];
  pagosRegistrados: number;
  errores: string[];
  /** Créditos en el listado que siguen sin historia de pagos. Se vuelve a llamar hasta que sea 0. */
  pendientes: number;
}

/**
 * Carga única de la historia de pagos de los créditos del listado. Apagada
 * hasta que SIAC dé el visto bueno (col_settings.carga_inicial_pagos.autorizada).
 * Una llamada por crédito, una por segundo, y a lo más un minuto por corrida.
 */
export async function runInitialPaymentsLoad(opts: { disparadoPor: string }): Promise<InitialLoadResult> {
  const config = getSiacConfig();
  if (!config) throw new Error("SIAC no está configurado (faltan variables SIAC_*)");
  const ambiente = config.ambiente;
  const result: InitialLoadResult = { runId: null, ambiente, status: "completado", procesados: [], pagosRegistrados: 0, errores: [], pendientes: 0 };

  const contarPendientes = async () => {
    const [{ n }] = await sql`
      SELECT count(*)::int AS n FROM col_credits WHERE ambiente = ${ambiente} AND en_listado AND pagos_sincronizados_at IS NULL
    `;
    return n as number;
  };

  const permiso = await getSetting<{ autorizada?: boolean }>("carga_inicial_pagos", { autorizada: false });
  if (!permiso.autorizada) {
    return { ...result, status: "no_autorizada", pendientes: await contarPendientes() };
  }

  const [run] = await sql`
    INSERT INTO col_sync_runs (ambiente, tipo, disparado_por) VALUES (${ambiente}, 'pagos', ${opts.disparadoPor}) RETURNING id
  `;
  result.runId = run.id;
  const siac = new SiacClient(config, siacCallRecorder(run.id));
  const inicio = Date.now();

  const creditos = await sql`
    SELECT id, client_id, numero_cliente, no_credito FROM col_credits
    WHERE ambiente = ${ambiente} AND en_listado AND pagos_sincronizados_at IS NULL
    ORDER BY no_credito
  `;
  for (const c of creditos) {
    if (Date.now() - inicio > PRESUPUESTO_CARGA_INICIAL_MS) break;
    try {
      const r = await fetchAndStorePayments(siac, run.id, { id: c.id, clientId: c.client_id, numeroCliente: c.numero_cliente, noCredito: c.no_credito });
      result.procesados.push({ noCredito: c.no_credito, pagos: r.total });
      result.pagosRegistrados += r.nuevos;
    } catch (e) {
      result.errores.push(`${c.no_credito}: ${(e as Error).message}`);
      // Un error que no se arregla solo (servicio no adquirido, parámetro faltante) detiene la carga.
      if (e instanceof SiacError && !e.reintentable) break;
    }
    await pausa();
  }

  result.pendientes = await contarPendientes();
  result.status = result.errores.length && !result.procesados.length ? "error" : "completado";
  await sql`
    UPDATE col_sync_runs SET
      status = ${result.status === "error" ? "error" : "completado"},
      creditos_leidos = ${result.procesados.length},
      eventos = ${result.pagosRegistrados},
      llamadas_siac = ${siac.llamadas},
      duracion_siac_ms = ${siac.duracionMs},
      error_detalle = ${result.errores.length ? result.errores.join("\n") : null},
      finished_at = now()
    WHERE id = ${run.id}
  `;
  return result;
}
