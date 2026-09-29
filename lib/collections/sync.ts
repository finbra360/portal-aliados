import { sql } from "@/lib/db";
import { SiacClient, getSiacConfig, type SiacAmbiente } from "@/lib/siac/client";
import { parseListado, type ListadoCredito } from "@/lib/siac/parse";
import { notifySlack } from "./notify";
import {
  UMBRAL_MORA_DEFAULT,
  aggregateClient,
  campoTelefonoPrincipal,
  deriveClientAlerts,
  deriveCreditEvents,
  fechaMexico,
  normalizePhoneMx,
  photoFreshness,
  resolvePromise,
  type CreditState,
} from "./rules";
import { closeAlerts, getSetting, insertEvent, openAlert, peso, siacCallRecorder, type Tx } from "./store";

export interface DailySyncResult {
  runId: number | null;
  ambiente: SiacAmbiente;
  fechaCorte: string;
  status: "completado" | "foto_vieja" | "error" | "ya_completada";
  foto: "actualizada" | "vieja" | "sin_evidencia" | null;
  creditos: number;
  clientes: number;
  eventos: number;
  alertas: number;
  salidasDelListado: number;
  promesasResueltas: number;
  llamadasSiac: number;
  duracionSiacMs: number;
  errores: string[];
  avisos: string[];
}

const llave = (numeroCliente: string, noCredito: string) => `${numeroCliente}|${noCredito}`;

const toState = (fechaCorte: string, c: ListadoCredito): CreditState => ({
  fechaCorte,
  antiguedad: c.foto.antiguedad,
  totalVencido: c.foto.totalVencido,
  vencimientosVencidos: c.foto.vencimientosVencidos,
  fechaUltimoPago: c.foto.fechaUltimoPago,
});

interface KnownCredit {
  id: string;
  clientId: string;
  noCredito: string;
  enListado: boolean;
  prev: CreditState | null;
}

/**
 * Foto diaria de la cartera con UNA llamada a ListadoCobranzaJSON.
 *
 * SIAC pidió no hacer cargas masivas con servicios individuales; el listado
 * lee la foto que su Monitor de Servicios guarda a las 00:00, así que la
 * sincronización corre después de esa hora con el corte de hoy. Todo lo del
 * día se guarda en una sola transacción: o queda la foto completa o no queda
 * nada.
 *
 * Si SIAC regresa exactamente la foto anterior (el Monitor no corrió), no se
 * guarda nada: se abre una alerta y la siguiente corrida lo reintenta.
 */
export async function runDailySync(opts: {
  disparadoPor: string;
  fechaCorte?: string;
  /** Reintento: no hace nada si ya hay una corrida completa para la fecha. */
  soloSiFalta?: boolean;
}): Promise<DailySyncResult> {
  const config = getSiacConfig();
  if (!config) throw new Error("SIAC no está configurado (faltan variables SIAC_*)");
  const ambiente = config.ambiente;

  const hoy = fechaMexico();
  const fechaCorte = opts.fechaCorte ?? hoy;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fechaCorte) || fechaCorte > hoy) {
    throw new Error(`Fecha de corte inválida: ${fechaCorte}. No puede ser posterior a ${hoy}.`);
  }

  const result: DailySyncResult = {
    runId: null,
    ambiente,
    fechaCorte,
    status: "completado",
    foto: null,
    creditos: 0,
    clientes: 0,
    eventos: 0,
    alertas: 0,
    salidasDelListado: 0,
    promesasResueltas: 0,
    llamadasSiac: 0,
    duracionSiacMs: 0,
    errores: [],
    avisos: [],
  };

  if (opts.soloSiFalta) {
    const [hecha] = await sql`
      SELECT id FROM col_sync_runs
      WHERE ambiente = ${ambiente} AND tipo = 'diaria' AND fecha_corte = ${fechaCorte} AND status = 'completado'
      LIMIT 1
    `;
    if (hecha) return { ...result, runId: hecha.id, status: "ya_completada" };
  }

  const [run] = await sql`
    INSERT INTO col_sync_runs (ambiente, tipo, fecha_corte, disparado_por)
    VALUES (${ambiente}, 'diaria', ${fechaCorte}, ${opts.disparadoPor})
    RETURNING id
  `;
  const runId = run.id as number;
  result.runId = runId;
  const siac = new SiacClient(config, siacCallRecorder(runId));

  try {
    // 1. La única llamada a SIAC del día.
    const { creditos, descartados } = parseListado(await siac.listadoCobranza(fechaCorte));
    for (const d of descartados) {
      result.avisos.push(`Crédito sin NoCredito o NumeroCliente en el listado: ${JSON.stringify(d.InformacionGeneral ?? {}).slice(0, 120)}`);
    }
    if (creditos.length === 0) throw new Error("SIAC regresó el listado de cobranza vacío");
    result.creditos = creditos.length;

    // 2. Lo que ya conocemos: créditos y su foto anterior más reciente.
    const conocidos = new Map<string, KnownCredit>();
    const filas = await sql`
      SELECT c.id, c.client_id, c.numero_cliente, c.no_credito, c.en_listado,
             to_char(s.fecha_corte, 'YYYY-MM-DD') AS fecha_corte, s.antiguedad, s.total_vencido,
             s.vencimientos_vencidos, to_char(s.fecha_ultimo_pago, 'YYYY-MM-DD') AS fecha_ultimo_pago
      FROM col_credits c
      LEFT JOIN LATERAL (
        SELECT * FROM col_credit_snapshots
        WHERE credit_id = c.id AND fecha_corte < ${fechaCorte}
        ORDER BY fecha_corte DESC LIMIT 1
      ) s ON true
      WHERE c.ambiente = ${ambiente}
    `;
    for (const f of filas) {
      conocidos.set(llave(f.numero_cliente, f.no_credito), {
        id: f.id,
        clientId: f.client_id,
        noCredito: f.no_credito,
        enListado: f.en_listado,
        prev: f.fecha_corte
          ? {
              fechaCorte: f.fecha_corte,
              antiguedad: Number(f.antiguedad),
              totalVencido: Number(f.total_vencido),
              vencimientosVencidos: f.vencimientos_vencidos === null ? null : Number(f.vencimientos_vencidos),
              fechaUltimoPago: f.fecha_ultimo_pago,
            }
          : null,
      });
    }

    // 3. ¿Es la foto de hoy o SIAC regresó la de antes?
    const prevMap = new Map<string, CreditState>();
    for (const [k, c] of conocidos) if (c.enListado && c.prev) prevMap.set(k, c.prev);
    const currMap = new Map(creditos.map((c) => [llave(c.numeroCliente, c.noCredito), toState(fechaCorte, c)]));
    result.foto = photoFreshness(prevMap, currMap);

    if (result.foto === "vieja") {
      result.status = "foto_vieja";
      await sql.begin(async (tx) => {
        result.alertas += await openAlert(tx, null, null, {
          tipo: "foto_vieja",
          severidad: "atencion",
          dedupeKey: `foto_vieja:${ambiente}`,
          detalle: { fechaCorte, runId },
        });
      });
    } else {
      const umbral = await getSetting("umbral_mora", UMBRAL_MORA_DEFAULT);
      await sql.begin((tx) => writeDailyPhoto(tx, { runId, ambiente, fechaCorte, creditos, conocidos, umbral, result }));
      result.promesasResueltas = await resolvePromises(ambiente, fechaCorte, umbral, result);
      await alertInvalidPhones(ambiente, fechaCorte, umbral, result);
    }
  } catch (e) {
    result.status = "error";
    result.errores.push((e as Error).message);
  }

  result.llamadasSiac = siac.llamadas;
  result.duracionSiacMs = siac.duracionMs;
  await sql`
    UPDATE col_sync_runs SET
      status = ${result.status},
      creditos_leidos = ${result.creditos},
      clientes_leidos = ${result.clientes},
      eventos = ${result.eventos},
      alertas = ${result.alertas},
      llamadas_siac = ${result.llamadasSiac},
      duracion_siac_ms = ${result.duracionSiacMs},
      error_detalle = ${result.errores.length ? result.errores.slice(0, 50).join("\n") : null},
      finished_at = now()
    WHERE id = ${runId}
  `;
  await reportRunOutcome(result);
  return result;
}

// ---------------------------------------------------------------- la foto del día

async function writeDailyPhoto(
  tx: Tx,
  p: {
    runId: number;
    ambiente: SiacAmbiente;
    fechaCorte: string;
    creditos: ListadoCredito[];
    conocidos: Map<string, KnownCredit>;
    umbral: number;
    result: DailySyncResult;
  },
) {
  const { runId, ambiente, fechaCorte, creditos, conocidos, umbral, result } = p;

  // Clientes y contactos. Un cliente con varios créditos aparece varias veces
  // en el listado; los datos de contacto se toman del primero que los traiga.
  const porCliente = new Map<string, ListadoCredito[]>();
  for (const c of creditos) porCliente.set(c.numeroCliente, [...(porCliente.get(c.numeroCliente) ?? []), c]);
  result.clientes = porCliente.size;

  const clientIds = new Map<string, string>();
  for (const [numeroCliente, suyos] of porCliente) {
    const primero = (campo: keyof ListadoCredito["contacto"]) => suyos.map((c) => c.contacto[campo]).find(Boolean) ?? null;
    const [row] = await tx`
      INSERT INTO col_clients (ambiente, numero_cliente, nombre, domicilio_particular, domicilio_trabajo)
      VALUES (${ambiente}, ${numeroCliente}, ${suyos[0].cliente}, ${primero("domicilioParticular")}, ${primero("domicilioTrabajo")})
      ON CONFLICT (ambiente, numero_cliente) DO UPDATE SET
        nombre = EXCLUDED.nombre,
        domicilio_particular = EXCLUDED.domicilio_particular,
        domicilio_trabajo = EXCLUDED.domicilio_trabajo,
        last_synced_at = now()
      RETURNING id
    `;
    clientIds.set(numeroCliente, row.id);

    const celular = primero("celular");
    const telefonoCliente = primero("telefonoCliente");
    const principal = campoTelefonoPrincipal({ celular, telefonoCliente });
    const contactos: { campo: string; relacion: "titular" | "aval" | "referencia"; tipo: "telefono" | "email"; valor: string | null; nombre: string | null }[] = [
      { campo: "Celular", relacion: "titular", tipo: "telefono", valor: celular, nombre: null },
      { campo: "TelefonoCliente", relacion: "titular", tipo: "telefono", valor: telefonoCliente, nombre: null },
      { campo: "CorreoCliente", relacion: "titular", tipo: "email", valor: primero("correoCliente"), nombre: null },
      { campo: "TelefonoAval", relacion: "aval", tipo: "telefono", valor: primero("telefonoAval"), nombre: primero("nombreAval") },
      { campo: "CorreoAval", relacion: "aval", tipo: "email", valor: primero("correoAval"), nombre: primero("nombreAval") },
      { campo: "TelefonoReferencia1", relacion: "referencia", tipo: "telefono", valor: primero("telefonoReferencia1"), nombre: primero("nombreReferencia1") },
      { campo: "TelefonoReferencia2", relacion: "referencia", tipo: "telefono", valor: primero("telefonoReferencia2"), nombre: primero("nombreReferencia2") },
    ];
    for (const k of contactos) {
      if (!k.valor) continue;
      const whatsapp = k.tipo === "telefono" ? normalizePhoneMx(k.valor) : null;
      // Si SIAC cambió el dato, la fila vuelve a 'activo': una marca de
      // "inválido" puesta por el equipo era sobre el valor anterior.
      await tx`
        INSERT INTO col_contacts (client_id, origen, relacion, campo_siac, tipo, valor_original, telefono_whatsapp, nombre_contacto, es_principal, created_by)
        VALUES (${row.id}, 'siac', ${k.relacion}, ${k.campo}, ${k.tipo}, ${k.valor}, ${whatsapp}, ${k.nombre}, ${k.campo === principal}, 'sistema')
        ON CONFLICT (client_id, campo_siac) WHERE origen = 'siac' DO UPDATE SET
          valor_original = EXCLUDED.valor_original,
          telefono_whatsapp = EXCLUDED.telefono_whatsapp,
          nombre_contacto = EXCLUDED.nombre_contacto,
          es_principal = EXCLUDED.es_principal,
          estatus = CASE WHEN col_contacts.valor_original IS DISTINCT FROM EXCLUDED.valor_original THEN 'activo' ELSE col_contacts.estatus END,
          updated_at = now()
        WHERE (col_contacts.valor_original, col_contacts.nombre_contacto, col_contacts.es_principal)
              IS DISTINCT FROM (EXCLUDED.valor_original, EXCLUDED.nombre_contacto, EXCLUDED.es_principal)
      `;
    }
  }

  // Créditos, fotos y eventos.
  const vistos = new Set<string>();
  const estadosCliente = new Map<string, { prev: CreditState[]; curr: CreditState[] }>();
  for (const c of creditos) {
    const k = llave(c.numeroCliente, c.noCredito);
    if (vistos.has(k)) {
      result.avisos.push(`Crédito ${c.noCredito} del cliente ${c.numeroCliente} viene repetido en el listado`);
      continue;
    }
    vistos.add(k);
    const clientId = clientIds.get(c.numeroCliente)!;
    const cr = c.credito;
    const [row] = await tx`
      INSERT INTO col_credits (
        ambiente, client_id, numero_cliente, no_credito, tipo_credito, tipo_producto, referencia, sucursal, municipio,
        id_cobrador, nombre_promotor, programa_especial, tasa, monto_credito, fecha_ministracion, fecha_termino_contrato,
        vencimientos, plazo_meses, frecuencia_pagos, en_listado, ultimo_listado, raw
      ) VALUES (
        ${ambiente}, ${clientId}, ${c.numeroCliente}, ${c.noCredito}, ${cr.tipoCredito}, ${cr.tipoProducto}, ${cr.referencia},
        ${cr.sucursal}, ${cr.municipio}, ${cr.idCobrador}, ${cr.nombrePromotor}, ${cr.programaEspecial}, ${cr.tasa},
        ${cr.montoCredito}, ${cr.fechaMinistracion}, ${cr.fechaTerminoContrato}, ${cr.vencimientos}, ${cr.plazoMeses},
        ${cr.frecuenciaPagos}, true, ${fechaCorte}, ${JSON.stringify(c.raw)}::jsonb
      )
      ON CONFLICT (ambiente, numero_cliente, no_credito) DO UPDATE SET
        client_id = EXCLUDED.client_id,
        tipo_credito = EXCLUDED.tipo_credito,
        tipo_producto = EXCLUDED.tipo_producto,
        referencia = EXCLUDED.referencia,
        sucursal = EXCLUDED.sucursal,
        municipio = EXCLUDED.municipio,
        id_cobrador = EXCLUDED.id_cobrador,
        nombre_promotor = EXCLUDED.nombre_promotor,
        programa_especial = EXCLUDED.programa_especial,
        tasa = EXCLUDED.tasa,
        monto_credito = EXCLUDED.monto_credito,
        fecha_ministracion = EXCLUDED.fecha_ministracion,
        fecha_termino_contrato = EXCLUDED.fecha_termino_contrato,
        vencimientos = EXCLUDED.vencimientos,
        plazo_meses = EXCLUDED.plazo_meses,
        frecuencia_pagos = EXCLUDED.frecuencia_pagos,
        en_listado = true,
        ultimo_listado = GREATEST(col_credits.ultimo_listado, EXCLUDED.ultimo_listado),
        raw = EXCLUDED.raw,
        last_synced_at = now()
      RETURNING id
    `;
    const creditId = row.id as string;
    const f = c.foto;
    const foto = {
      credit_id: creditId,
      fecha_corte: fechaCorte,
      sync_run_id: runId,
      antiguedad: f.antiguedad,
      atraso_maximo: f.atrasoMaximo,
      fecha_ultimo_pago: f.fechaUltimoPago,
      numero_veces_mora: f.numeroVecesMora,
      vencimientos_cubiertos: f.vencimientosCubiertos,
      vencimientos_vencidos: f.vencimientosVencidos,
      vencimientos_por_vencer: f.vencimientosPorVencer,
      dias_sin_movimiento: f.diasSinMovimiento,
      proximo_vencimiento: f.proximoVencimiento,
      monto_por_vencer: f.montoPorVencer,
      intereses_moratorios: f.interesesMoratorios,
      iva_vencido: f.ivaVencido,
      total_vencido: f.totalVencido,
      total_adeudo: f.totalAdeudo,
      total_global: f.totalGlobal,
    };
    const { credit_id: _c, fecha_corte: _f, ...cambios } = foto;
    await tx`
      INSERT INTO col_credit_snapshots ${tx(foto)}
      ON CONFLICT (credit_id, fecha_corte) DO UPDATE SET ${tx(cambios)}, obtenido_at = now()
    `;

    const prev = conocidos.get(k)?.prev ?? null;
    const curr = toState(fechaCorte, c);
    for (const ev of deriveCreditEvents(prev, curr)) {
      result.eventos += await insertEvent(tx, { runId, creditId, clientId, noCredito: c.noCredito, tipo: ev.tipo, event: ev });
    }
    const e = estadosCliente.get(clientId) ?? { prev: [], curr: [] };
    if (prev) e.prev.push(prev);
    e.curr.push(curr);
    estadosCliente.set(clientId, e);
  }

  // Créditos que en la foto anterior estaban en el listado y hoy no.
  for (const [k, c] of conocidos) {
    if (!c.enListado || vistos.has(k)) continue;
    await tx`UPDATE col_credits SET en_listado = false WHERE id = ${c.id}`;
    result.salidasDelListado++;
    result.eventos += await insertEvent(tx, {
      runId,
      creditId: c.id,
      clientId: c.clientId,
      noCredito: c.noCredito,
      tipo: "salida_listado",
      event: { fechaEvento: fechaCorte, antiguedadAntes: c.prev?.antiguedad, vencidoAntes: c.prev?.totalVencido },
    });
  }

  // Alertas por cliente: la mora se decide con el total del cliente, no por crédito.
  for (const [clientId, e] of estadosCliente) {
    const prev = e.prev.length ? aggregateClient(e.prev) : null;
    for (const al of deriveClientAlerts(prev, aggregateClient(e.curr), clientId, umbral, fechaCorte)) {
      result.alertas += await openAlert(tx, clientId, null, al);
    }
  }

  // Una foto buena cierra las alertas de corridas anteriores que fallaron.
  await closeAlerts(tx, [`sync_fallido:${ambiente}`, `foto_vieja:${ambiente}`]);
}

// ---------------------------------------------------------------- promesas y teléfonos

async function resolvePromises(ambiente: SiacAmbiente, fechaCorte: string, umbral: number, result: DailySyncResult): Promise<number> {
  const vigentes = await sql`
    SELECT p.id, p.client_id, p.credit_id, p.monto, p.vencido_al_crear,
           to_char(p.created_at AT TIME ZONE 'America/Mexico_City', 'YYYY-MM-DD') AS creada_el,
           to_char(p.fecha_compromiso, 'YYYY-MM-DD') AS fecha_compromiso,
           (SELECT coalesce(sum(s.total_vencido), 0)
              FROM col_credit_snapshots s JOIN col_credits cr ON cr.id = s.credit_id
             WHERE cr.client_id = p.client_id AND s.fecha_corte = ${fechaCorte}
               AND (p.credit_id IS NULL OR cr.id = p.credit_id)) AS vencido_actual,
           (SELECT coalesce(array_agg(to_char(e.fecha_evento, 'YYYY-MM-DD')), '{}')
              FROM col_credit_events e JOIN col_credits cr ON cr.id = e.credit_id
             WHERE e.tipo = 'pago_detectado' AND cr.client_id = p.client_id
               AND (p.credit_id IS NULL OR cr.id = p.credit_id)) AS fechas_pago
    FROM col_promises p JOIN col_clients c ON c.id = p.client_id
    WHERE p.estado = 'vigente' AND c.ambiente = ${ambiente}
  `;
  let resueltas = 0;
  for (const p of vigentes) {
    const estado = resolvePromise(
      { monto: Number(p.monto), creadaEl: p.creada_el, fechaCompromiso: p.fecha_compromiso, vencidoAlCrear: Number(p.vencido_al_crear) },
      p.fechas_pago as string[],
      Number(p.vencido_actual),
      fechaCorte,
      umbral,
    );
    if (estado === "vigente") continue;

    await sql.begin(async (tx) => {
      const [upd] = await tx`
        UPDATE col_promises SET estado = ${estado}, resuelta_por = 'sistema', resuelta_at = now()
        WHERE id = ${p.id} AND estado = 'vigente'
        RETURNING id
      `;
      if (!upd) return;
      resueltas++;
      await tx`
        INSERT INTO col_activities (client_id, credit_id, tipo, descripcion, promise_id, actor)
        VALUES (${p.client_id}, ${p.credit_id}, 'promesa_resuelta',
                ${`Promesa de ${peso(Number(p.monto))} al ${p.fecha_compromiso}: ${estado} (según SIAC; sin monto de pago confirmado)`},
                ${p.id}, 'sistema')
      `;
      if (estado !== "cumplida") {
        result.alertas += await openAlert(tx, p.client_id, p.credit_id, {
          tipo: "promesa_incumplida",
          severidad: estado === "incumplida" ? "critica" : "atencion",
          dedupeKey: `promesa_incumplida:${p.id}`,
          detalle: { promesaId: p.id, monto: Number(p.monto), fechaCompromiso: p.fecha_compromiso, estado, vencidoActual: Number(p.vencido_actual) },
        });
      }
    });
  }
  return resueltas;
}

/** Clientes en mora cuyo teléfono principal no sirve para WhatsApp (hay que corregirlo en SIAC). */
async function alertInvalidPhones(ambiente: SiacAmbiente, fechaCorte: string, umbral: number, result: DailySyncResult) {
  const sinTelefono = await sql`
    SELECT c.id, sum(s.total_vencido) AS vencido
    FROM col_clients c
    JOIN col_credits cr ON cr.client_id = c.id
    JOIN col_credit_snapshots s ON s.credit_id = cr.id AND s.fecha_corte = ${fechaCorte}
    WHERE c.ambiente = ${ambiente}
      AND NOT EXISTS (
        SELECT 1 FROM col_contacts k
        WHERE k.client_id = c.id AND k.relacion = 'titular' AND k.es_principal
          AND k.telefono_whatsapp IS NOT NULL AND k.estatus = 'activo' AND k.baja_whatsapp_at IS NULL
      )
    GROUP BY c.id
    HAVING sum(s.total_vencido) >= ${umbral}
  `;
  for (const c of sinTelefono) {
    await sql.begin(async (tx) => {
      result.alertas += await openAlert(tx, c.id, null, {
        tipo: "telefono_invalido",
        severidad: "atencion",
        dedupeKey: `telefono_invalido:${c.id}`,
        detalle: { totalVencido: Number(c.vencido), fecha: fechaCorte },
      });
    });
  }
}

// ---------------------------------------------------------------- resultado de la corrida

async function reportRunOutcome(result: DailySyncResult) {
  if (result.status === "completado" || result.status === "ya_completada") return;

  if (result.status === "error") {
    await sql.begin(async (tx) => {
      await openAlert(tx, null, null, {
        tipo: "sync_fallido",
        severidad: "critica",
        dedupeKey: `sync_fallido:${result.ambiente}`,
        detalle: { runId: result.runId, fechaCorte: result.fechaCorte, errores: result.errores.slice(0, 10) },
      });
    });
  }

  const titulo =
    result.status === "error"
      ? `:rotating_light: Falló la sincronización de cartera con SIAC (${result.ambiente}, corte ${result.fechaCorte})`
      : `:warning: SIAC regresó la misma foto que la anterior (${result.ambiente}, corte ${result.fechaCorte}). Parece que su Monitor de Servicios no corrió; no se guardó nada y se reintenta más tarde.`;
  const detalle = result.errores.slice(0, 5).map((e) => `• ${e}`).join("\n");
  await notifySlack(`${titulo}${detalle ? `\n${detalle}` : ""}\nCorrida #${result.runId}. El backoffice sigue mostrando la última foto completa.`);
}
