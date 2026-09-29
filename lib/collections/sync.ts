import { sql } from "@/lib/db";
import { SiacClient, SiacError, getSiacConfig, type SiacAmbiente } from "@/lib/siac/client";
import { siacDate, toSnapshotValues } from "@/lib/siac/parse";
import type { SiacCliente, SiacCredito } from "@/lib/siac/types";
import { notifySlack } from "./notify";
import {
  dayValues,
  insertEvent,
  loadPrevState,
  openAlert,
  peso,
  siacCallRecorder,
  upsertSnapshot,
  type ActiveCredit,
  type Tx,
} from "./store";
import {
  MAX_DIAS_RELLENO,
  UMBRAL_MORA,
  addDays,
  daysBetween,
  deriveCreditAlerts,
  deriveDay,
  fechaMexico,
  normalizePhoneMx,
  resolvePromise,
  type DayState,
} from "./rules";

const CONCURRENCIA_SIAC = 5;
const PAUSA_ENTRE_LLAMADAS_MS = 150;

export interface DailySyncResult {
  runId: number;
  ambiente: SiacAmbiente;
  fechaCorte: string;
  status: "completado" | "parcial" | "error";
  clientes: number;
  creditos: number;
  snapshots: number;
  eventos: number;
  alertas: number;
  promesasResueltas: number;
  llamadasSiac: number;
  errores: string[];
  avisos: string[];
}

/** Corre `fn` sobre `items` con a lo más `limite` llamadas a la vez, para no saturar a SIAC. */
async function mapLimit<T>(items: T[], limite: number, fn: (item: T) => Promise<void>): Promise<void> {
  let i = 0;
  const worker = async () => {
    while (i < items.length) {
      const item = items[i++];
      await fn(item);
      await new Promise((r) => setTimeout(r, PAUSA_ENTRE_LLAMADAS_MS));
    }
  };
  await Promise.all(Array.from({ length: Math.min(limite, items.length) }, worker));
}

function esLunesEnMexico(fecha: string): boolean {
  return new Date(`${fecha}T12:00:00Z`).getUTCDay() === 1;
}

/**
 * Foto diaria de la cartera: clientes → créditos → saldo al cierre de
 * `fechaCorte` (por defecto, ayer en hora de CDMX), y a partir de la
 * comparación con la foto anterior: eventos, alertas, timeline y promesas.
 *
 * Se puede correr varias veces para la misma fecha sin duplicar nada: las
 * fotos se sobrescriben, y eventos y alertas tienen llaves únicas.
 */
export async function runDailySync(opts: {
  disparadoPor: string;
  fechaCorte?: string;
  consultarTodosLosClientes?: boolean;
}): Promise<DailySyncResult> {
  const config = getSiacConfig();
  if (!config) throw new Error("SIAC no está configurado (faltan variables SIAC_*)");

  const hoy = fechaMexico();
  const fechaCorte = opts.fechaCorte ?? addDays(hoy, -1);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fechaCorte) || fechaCorte >= hoy) {
    // SIAC proyecta moratorios para fechas futuras y el día de hoy no ha cerrado.
    throw new Error(`Fecha de corte inválida: ${fechaCorte}. Debe ser anterior a ${hoy}.`);
  }

  const ambiente = config.ambiente;
  const [run] = await sql`
    INSERT INTO col_sync_runs (ambiente, tipo, fecha_corte, disparado_por)
    VALUES (${ambiente}, 'diaria', ${fechaCorte}, ${opts.disparadoPor})
    RETURNING id
  `;
  const runId = run.id as number;

  const result: DailySyncResult = {
    runId,
    ambiente,
    fechaCorte,
    status: "completado",
    clientes: 0,
    creditos: 0,
    snapshots: 0,
    eventos: 0,
    alertas: 0,
    promesasResueltas: 0,
    llamadasSiac: 0,
    errores: [],
    avisos: [],
  };

  const siac = new SiacClient(config, siacCallRecorder(runId));

  try {
    // 1. Clientes y sus contactos de SIAC.
    const { ClienteOuts = [] } = await siac.consultarClientes();
    const clientes = new Map<string, SiacCliente>();
    for (const c of ClienteOuts) if (c.IdCliente && !clientes.has(c.IdCliente)) clientes.set(c.IdCliente, c);
    if (clientes.size === 0) throw new Error("SIAC no regresó clientes");

    const clientIds = new Map<string, string>(); // id_cliente_siac -> uuid
    const nuevos = new Set<string>();
    await sql.begin(async (tx) => {
      for (const c of clientes.values()) {
        const [row] = await tx`
          INSERT INTO col_clients (ambiente, id_cliente_siac, nombre, rfc, raw)
          VALUES (${ambiente}, ${c.IdCliente}, ${(c.Nombre ?? "").trim() || "(sin nombre en SIAC)"}, ${c.Rfc ?? null},
                  ${JSON.stringify(c)}::jsonb)
          ON CONFLICT (ambiente, id_cliente_siac) DO UPDATE
            SET nombre = EXCLUDED.nombre, rfc = EXCLUDED.rfc, raw = EXCLUDED.raw, last_synced_at = now()
          RETURNING id, (xmax = 0) AS nuevo
        `;
        clientIds.set(c.IdCliente, row.id);
        if (row.nuevo) nuevos.add(c.IdCliente);
        await upsertSiacContacts(tx, row.id, c);
      }
    });
    result.clientes = clientes.size;

    // 2. Créditos. Diario solo de clientes con créditos activos y de clientes
    // nuevos; los lunes (o en la primera corrida) de todos, para detectar
    // créditos nuevos de clientes viejos.
    const [{ n: creditosConocidos }] = await sql`SELECT count(*)::int AS n FROM col_credits WHERE ambiente = ${ambiente}`;
    const todos = opts.consultarTodosLosClientes || creditosConocidos === 0 || esLunesEnMexico(hoy);
    let aConsultar: string[];
    if (todos) {
      aConsultar = [...clientes.keys()];
    } else {
      const activos = await sql`
        SELECT DISTINCT id_cliente_siac FROM col_credits WHERE ambiente = ${ambiente} AND estatus_siac = 'ACTIVO'
      `;
      aConsultar = [...new Set([...activos.map((r) => r.id_cliente_siac as string), ...nuevos])].filter((id) =>
        clientIds.has(id),
      );
    }

    await mapLimit(aConsultar, CONCURRENCIA_SIAC, async (idCliente) => {
      try {
        const { ListadoCreditos = [] } = await siac.consultarCreditos(idCliente);
        for (const cr of ListadoCreditos) await upsertCredit(ambiente, clientIds.get(idCliente)!, cr, result);
      } catch (e) {
        // Un Detalle de SIAC (p. ej. cliente sin créditos) es aviso; un fallo de red es error.
        if (e instanceof SiacError && e.detalle) result.avisos.push(`Cliente ${idCliente}: ${e.detalle}`);
        else result.errores.push(`ConsultarCreditos ${idCliente}: ${(e as Error).message}`);
      }
    });

    // 3. Foto de saldo de cada crédito activo, rellenando huecos cortos día por día.
    const activos = await sql`
      SELECT id, client_id, id_cliente_siac, no_control, to_char(fecha_alta, 'YYYY-MM-DD') AS fecha_alta
      FROM col_credits WHERE ambiente = ${ambiente} AND estatus_siac = 'ACTIVO'
    `;
    result.creditos = activos.length;

    await mapLimit([...activos], CONCURRENCIA_SIAC, async (cr) => {
      try {
        await syncCreditBalance(siac, runId, cr as unknown as ActiveCredit, fechaCorte, result);
      } catch (e) {
        result.errores.push(`Saldo ${cr.no_control}: ${(e as Error).message}`);
      }
    });

    // 4. Promesas y alertas a nivel cliente.
    result.promesasResueltas = await resolvePromises(ambiente, result);
    await alertInvalidPhones(ambiente, fechaCorte, result);

    result.status = result.errores.length === 0 ? "completado" : result.snapshots > 0 ? "parcial" : "error";
  } catch (e) {
    result.status = "error";
    result.errores.push((e as Error).message);
  }

  result.llamadasSiac = siac.llamadas;
  await sql`
    UPDATE col_sync_runs SET
      status = ${result.status},
      clientes_leidos = ${result.clientes},
      creditos_leidos = ${result.creditos},
      snapshots_guardados = ${result.snapshots},
      llamadas_siac = ${result.llamadasSiac},
      errores = ${result.errores.length},
      error_detalle = ${result.errores.length ? result.errores.slice(0, 50).join("\n") : null},
      finished_at = now()
    WHERE id = ${runId}
  `;

  await reportRunOutcome(result);
  return result;
}

// ---------------------------------------------------------------- clientes y créditos

const CAMPOS_CONTACTO: { campo: "Celular" | "NumeroTelefono" | "Email" | "Email2"; tipo: "telefono" | "email" }[] = [
  { campo: "Celular", tipo: "telefono" },
  { campo: "NumeroTelefono", tipo: "telefono" },
  { campo: "Email", tipo: "email" },
  { campo: "Email2", tipo: "email" },
];

async function upsertSiacContacts(tx: Tx, clientId: string, c: SiacCliente) {
  for (const { campo, tipo } of CAMPOS_CONTACTO) {
    const valor = String(c[campo] ?? "").trim();
    if (!valor) continue;
    const whatsapp = tipo === "telefono" ? normalizePhoneMx(valor) : null;
    // Si SIAC cambió el dato, la fila vuelve a 'activo': una marca de
    // "inválido" puesta por el equipo era sobre el número anterior.
    await tx`
      INSERT INTO col_contacts (client_id, origen, campo_siac, tipo, valor_original, telefono_whatsapp, es_principal, created_by)
      VALUES (${clientId}, 'siac', ${campo}, ${tipo}, ${valor}, ${whatsapp}, ${campo === "Celular"}, 'sistema')
      ON CONFLICT (client_id, campo_siac) WHERE origen = 'siac' DO UPDATE
        SET valor_original = EXCLUDED.valor_original,
            telefono_whatsapp = EXCLUDED.telefono_whatsapp,
            estatus = 'activo',
            updated_at = now()
        WHERE col_contacts.valor_original IS DISTINCT FROM EXCLUDED.valor_original
    `;
  }
}

async function upsertCredit(ambiente: SiacAmbiente, clientId: string, cr: SiacCredito, result: DailySyncResult) {
  const g = cr.Generales;
  const f: Partial<SiacCredito["CondicionesFinanciamiento"]> = cr.CondicionesFinanciamiento ?? {};
  const o: Partial<SiacCredito["Otros"]> = cr.Otros ?? {};
  const fechaAlta = siacDate(g.FechaAlta);
  if (!g.NoControl || !fechaAlta) {
    result.avisos.push(`Crédito sin NoControl o FechaAlta del cliente ${g.IDCliente}`);
    return;
  }
  // Solo campos de SIAC: asignado_a y etapa_manual son del equipo y no se tocan.
  await sql`
    INSERT INTO col_credits (
      ambiente, client_id, id_cliente_siac, no_control, tipo_credito, fecha_alta, monto_credito,
      frecuencia_pago, numero_vencimientos, esquema_pago, tasa_normal, tasa_normal_puntos,
      tasa_moratoria, tasa_moratoria_puntos, tasa_moratoria_factor, estatus_siac, promotor, referencia,
      condiciones, raw
    ) VALUES (
      ${ambiente}, ${clientId}, ${g.IDCliente}, ${g.NoControl}, ${g.TipoCredito ?? null}, ${fechaAlta},
      ${Number(g.MontoCredito) || 0}, ${f.FrecuenciaPago ?? null}, ${f.NumeroVencimientos ?? null},
      ${f.EsquemaPago ?? null}, ${f.TasaNormal ?? null}, ${f.TasaNormalPuntosAdicionales ?? null},
      ${f.TasaMoratoria ?? null}, ${f.TasaMoratoriaPuntosAdicionales ?? null}, ${f.TasaMoratoriaFactor ?? null},
      ${String(o.EstatusCredito ?? "").toUpperCase() || "DESCONOCIDO"}, ${o.Promotor ?? null}, ${o.Referencia ?? null},
      ${JSON.stringify(f)}::jsonb, ${JSON.stringify(cr)}::jsonb
    )
    ON CONFLICT (ambiente, id_cliente_siac, no_control) DO UPDATE SET
      client_id = EXCLUDED.client_id,
      tipo_credito = EXCLUDED.tipo_credito,
      fecha_alta = EXCLUDED.fecha_alta,
      monto_credito = EXCLUDED.monto_credito,
      frecuencia_pago = EXCLUDED.frecuencia_pago,
      numero_vencimientos = EXCLUDED.numero_vencimientos,
      esquema_pago = EXCLUDED.esquema_pago,
      tasa_normal = EXCLUDED.tasa_normal,
      tasa_normal_puntos = EXCLUDED.tasa_normal_puntos,
      tasa_moratoria = EXCLUDED.tasa_moratoria,
      tasa_moratoria_puntos = EXCLUDED.tasa_moratoria_puntos,
      tasa_moratoria_factor = EXCLUDED.tasa_moratoria_factor,
      estatus_siac = EXCLUDED.estatus_siac,
      promotor = EXCLUDED.promotor,
      referencia = EXCLUDED.referencia,
      condiciones = EXCLUDED.condiciones,
      raw = EXCLUDED.raw,
      last_synced_at = now()
  `;
}

// ---------------------------------------------------------------- saldos, eventos y alertas

async function syncCreditBalance(
  siac: SiacClient,
  runId: number,
  cr: ActiveCredit,
  fechaCorte: string,
  result: DailySyncResult,
) {
  let prev = await loadPrevState(cr.id, fechaCorte);

  // Días a pedir: si la última foto es de hace pocos días (falló alguna
  // corrida), se rellenan uno por uno para que los eventos tengan su fecha
  // exacta. Si el hueco es largo o no hay foto previa, solo se pide la fecha
  // de corte y ese crédito queda para la reconstrucción histórica.
  let fechas = [fechaCorte];
  if (prev) {
    const hueco = daysBetween(prev.fechaCorte, fechaCorte);
    if (hueco > 1 && hueco <= MAX_DIAS_RELLENO) {
      fechas = Array.from({ length: hueco }, (_, i) => addDays(prev!.fechaCorte, i + 1));
    } else if (hueco > MAX_DIAS_RELLENO) {
      result.avisos.push(`Crédito ${cr.no_control}: ${hueco} días sin foto; correr la reconstrucción con ?credito=${cr.no_control}`);
      prev = null;
    }
  }
  fechas = fechas.filter((f) => f >= cr.fecha_alta);

  for (const fecha of fechas) {
    const values = toSnapshotValues(await siac.consultarSaldoCredito(cr.no_control, cr.id_cliente_siac, fecha));
    const { vencidoDesde, events } = deriveDay(prev, dayValues(fecha, values));
    const state: DayState = { ...dayValues(fecha, values), vencidoDesde };
    const alerts = deriveCreditAlerts(prev, state, cr.id);

    await sql.begin(async (tx) => {
      await upsertSnapshot(tx, { creditId: cr.id, fechaCorte: fecha, origen: "diaria", runId, values, vencidoDesde });
      for (const ev of events) result.eventos += await insertEvent(tx, runId, cr, ev);
      for (const al of alerts) result.alertas += await openAlert(tx, cr.client_id, cr.id, al);
    });
    result.snapshots++;
    prev = state;
  }
}

// ---------------------------------------------------------------- promesas y alertas de cliente

async function resolvePromises(ambiente: SiacAmbiente, result: DailySyncResult): Promise<number> {
  const vigentes = await sql`
    SELECT p.id, p.client_id, p.credit_id, p.monto, p.monto_pagado,
           to_char(p.created_at AT TIME ZONE 'America/Mexico_City', 'YYYY-MM-DD') AS creada_el,
           to_char(p.fecha_compromiso, 'YYYY-MM-DD') AS fecha_compromiso
    FROM col_promises p JOIN col_clients c ON c.id = p.client_id
    WHERE p.estado = 'vigente' AND c.ambiente = ${ambiente}
  `;
  let resueltas = 0;
  for (const p of vigentes) {
    const pagos = await sql`
      SELECT to_char(e.fecha_evento, 'YYYY-MM-DD') AS fecha, e.monto
      FROM col_credit_events e JOIN col_credits cr ON cr.id = e.credit_id
      WHERE e.tipo = 'pago' AND cr.client_id = ${p.client_id}
        AND (${p.credit_id}::uuid IS NULL OR e.credit_id = ${p.credit_id})
        AND e.fecha_evento >= ${p.creada_el}
    `;
    // Solo se da por incumplida con datos de SIAC de todos los créditos
    // involucrados: si uno falló hoy, se usa su foto más vieja.
    const [{ datos_hasta: datosHasta }] = await sql`
      SELECT to_char(min(ultima), 'YYYY-MM-DD') AS datos_hasta FROM (
        SELECT max(s.fecha_corte) AS ultima
        FROM col_balance_snapshots s JOIN col_credits cr ON cr.id = s.credit_id
        WHERE cr.client_id = ${p.client_id} AND (${p.credit_id}::uuid IS NULL OR cr.id = ${p.credit_id})
        GROUP BY cr.id
      ) t
    `;
    if (!datosHasta) continue;

    const r = resolvePromise(
      { monto: Number(p.monto), creadaEl: p.creada_el, fechaCompromiso: p.fecha_compromiso },
      pagos.map((x) => ({ fecha: x.fecha, monto: Number(x.monto) })),
      datosHasta,
    );
    if (r.estado === "vigente" && r.montoPagado === Number(p.monto_pagado)) continue;

    await sql.begin(async (tx) => {
      const [upd] = await tx`
        UPDATE col_promises SET
          estado = ${r.estado},
          monto_pagado = ${r.montoPagado},
          resuelta_por = ${r.estado === "vigente" ? null : "sistema"},
          resuelta_at = ${r.estado === "vigente" ? null : sql`now()`}
        WHERE id = ${p.id} AND estado = 'vigente'
        RETURNING id
      `;
      if (!upd || r.estado === "vigente") return;
      resueltas++;
      await tx`
        INSERT INTO col_activities (client_id, credit_id, tipo, descripcion, promise_id, actor)
        VALUES (${p.client_id}, ${p.credit_id}, 'promesa_resuelta',
                ${`Promesa de ${peso(Number(p.monto))} al ${p.fecha_compromiso}: ${r.estado} (pagado ${peso(r.montoPagado)})`},
                ${p.id}, 'sistema')
      `;
      if (r.estado !== "cumplida") {
        result.alertas += await openAlert(tx, p.client_id, p.credit_id, {
          tipo: "promesa_incumplida",
          severidad: r.estado === "incumplida" ? "critica" : "atencion",
          dedupeKey: `promesa_incumplida:${p.id}`,
          detalle: { promesaId: p.id, monto: Number(p.monto), montoPagado: r.montoPagado, fechaCompromiso: p.fecha_compromiso },
        });
      }
    });
  }
  return resueltas;
}

/** Clientes en mora sin ningún teléfono al que se le pueda mandar WhatsApp. */
async function alertInvalidPhones(ambiente: SiacAmbiente, fechaCorte: string, result: DailySyncResult) {
  const sinTelefono = await sql`
    SELECT c.id, sum(s.saldo_vencido) AS vencido
    FROM col_clients c
    JOIN col_credits cr ON cr.client_id = c.id AND cr.estatus_siac = 'ACTIVO'
    JOIN col_balance_snapshots s ON s.credit_id = cr.id AND s.fecha_corte = ${fechaCorte}
    WHERE c.ambiente = ${ambiente}
      AND NOT EXISTS (
        SELECT 1 FROM col_contacts k
        WHERE k.client_id = c.id AND k.telefono_whatsapp IS NOT NULL
          AND k.estatus = 'activo' AND k.baja_whatsapp_at IS NULL
      )
    GROUP BY c.id
    HAVING sum(s.saldo_vencido) >= ${UMBRAL_MORA}
  `;
  for (const c of sinTelefono) {
    await sql.begin(async (tx) => {
      result.alertas += await openAlert(tx, c.id, null, {
        tipo: "telefono_invalido",
        severidad: "atencion",
        dedupeKey: `telefono_invalido:${c.id}`,
        detalle: { saldoVencido: Number(c.vencido), fecha: fechaCorte },
      });
    });
  }
}

// ---------------------------------------------------------------- resultado de la corrida

async function reportRunOutcome(result: DailySyncResult) {
  const llave = `sync_fallido:${result.ambiente}`;
  if (result.status === "completado") {
    // Una corrida buena cierra la alerta de la corrida fallida anterior.
    await sql`
      UPDATE col_alerts SET estado = 'atendida', atendida_por = 'sistema', atendida_at = now()
      WHERE dedupe_key = ${llave} AND estado = 'abierta'
    `;
    return;
  }

  await sql.begin(async (tx) => {
    await openAlert(tx, null, null, {
      tipo: "sync_fallido",
      severidad: result.status === "error" ? "critica" : "atencion",
      dedupeKey: llave,
      detalle: { runId: result.runId, fechaCorte: result.fechaCorte, errores: result.errores.slice(0, 10) },
    });
  });

  const titulo =
    result.status === "error"
      ? `:rotating_light: Falló la sincronización de cartera con SIAC (${result.ambiente}, corte ${result.fechaCorte})`
      : `:warning: Sincronización de cartera incompleta (${result.ambiente}, corte ${result.fechaCorte}): ${result.snapshots} fotos guardadas, ${result.errores.length} errores`;
  const detalle = result.errores.slice(0, 5).map((e) => `• ${e}`).join("\n");
  await notifySlack(`${titulo}\n${detalle}\nCorrida #${result.runId}. El backoffice sigue mostrando el último día completo.`);
}
