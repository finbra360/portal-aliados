// Recordatorios preventivos por WhatsApp (5 días antes, 1 día antes y el día
// del pago) desde los datos de SIAC, sin Google Sheets. Mismo mecanismo de
// envío que los de mora (enviarLote): registro antes de llamar a Meta, sin
// duplicados, alerta si falla.

import { sql } from "@/lib/db";
import { logAudit } from "@/lib/db/audit";
import { ambienteActual, getPhotoStatus } from "@/lib/db/collections";
import { getSetting } from "@/lib/collections/store";
import { UMBRAL_MORA_DEFAULT, addDays, fechaMexico } from "@/lib/collections/rules";
import { bloqueosDeEnvio } from "@/lib/collections/whatsapp-mora";
import {
  ETAPAS,
  UMBRALES_SEMAFORO_DEFAULT,
  MOTIVO_FALTA_MONTO,
  decidirPreventivo,
  semaforo,
  type PreventivoCandidate,
  type PreventivoDecision,
  type Semaforo,
  type UmbralesSemaforo,
} from "@/lib/collections/preventivos";
import { getWhatsAppConfig } from "@/lib/whatsapp/client";
import { enviarLote, plantillasDe, type MoraRunResult, type PlantillaMora } from "@/lib/db/whatsapp-mora";
import { consultarSaldoAlDia } from "@/lib/db/collection-gestiones";

const VENTANA_DEFAULT = { desde: "09:00", hasta: "19:00" };

const horaMexico = (d = new Date()) =>
  new Intl.DateTimeFormat("en-GB", { timeZone: "America/Mexico_City", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(d);

/**
 * Monto de la próxima mensualidad según SIAC: el saldo vencido que da
 * ConsultarSaldoCredito con FechaCorte = ProximoVencimiento (probado con el
 * crédito 1109 el 2026-10-15: $172,665.64 = capital + intereses de la cuota,
 * igual que la cuota anterior que pagó). Aquí solo se LEEN las consultas ya
 * guardadas; quien pregunta a SIAC es obtenerMontosPreventivos.
 *
 * Una consulta deja de servir si el cliente pagó algo después de hacerla (el
 * monto pudo cambiar): entonces se vuelve a preguntar.
 */
async function montosGuardados(creditos: { id: string; proximo_vencimiento: string; fecha_ultimo_pago: string | null }[]): Promise<Map<string, number>> {
  if (creditos.length === 0) return new Map();
  const rows = await sql`
    SELECT DISTINCT ON (q.credit_id) q.credit_id, to_char(q.fecha_corte, 'YYYY-MM-DD') AS fecha_corte, q.saldo_vencido,
           to_char(q.created_at AT TIME ZONE 'America/Mexico_City', 'YYYY-MM-DD') AS consultado
    FROM col_saldo_consultas q
    WHERE q.credit_id = ANY(${creditos.map((c) => c.id)}::uuid[])
    ORDER BY q.credit_id, q.created_at DESC
  `;
  const porId = new Map(creditos.map((c) => [c.id, c]));
  const montos = new Map<string, number>();
  for (const r of rows) {
    const c = porId.get(r.credit_id as string);
    if (!c || r.fecha_corte !== c.proximo_vencimiento) continue;
    if (c.fecha_ultimo_pago && c.fecha_ultimo_pago >= (r.consultado as string)) continue;
    montos.set(c.id, Number(r.saldo_vencido));
  }
  return montos;
}

async function umbralesSemaforo(): Promise<UmbralesSemaforo> {
  const s = await getSetting<{ rojo_veces?: number; rojo_atraso?: number }>("semaforo", {});
  return { rojoVeces: s.rojo_veces ?? UMBRALES_SEMAFORO_DEFAULT.rojoVeces, rojoAtraso: s.rojo_atraso ?? UMBRALES_SEMAFORO_DEFAULT.rojoAtraso };
}

/** Créditos de la foto que vencen entre hoy y dentro de 5 días, con todo lo que decide el recordatorio. */
async function candidatos(fechaCorte: string, hoy: string, umbralMora: number): Promise<PreventivoCandidate[]> {
  const ambiente = ambienteActual();
  const [creditos, contactos] = await Promise.all([
    sql`
      WITH cliente AS (
        SELECT cr.client_id,
               sum(s.total_vencido) AS vencido,
               max(coalesce(s.numero_veces_mora, 0)) AS veces,
               max(coalesce(s.atraso_maximo, 0)) AS atraso
        FROM col_credits cr JOIN col_credit_snapshots s ON s.credit_id = cr.id AND s.fecha_corte = ${fechaCorte}
        GROUP BY cr.client_id
      )
      SELECT cr.id, cr.client_id, cr.no_credito, cr.etapa_manual, c.nombre, c.contacto_cobranza_id,
             to_char(c.pausa_hasta, 'YYYY-MM-DD') AS pausa_hasta,
             to_char(s.proximo_vencimiento, 'YYYY-MM-DD') AS proximo_vencimiento,
             to_char(s.fecha_ultimo_pago, 'YYYY-MM-DD') AS fecha_ultimo_pago,
             k.vencido, k.veces, k.atraso,
             (SELECT row_to_json(a) FROM (SELECT banco, beneficiario, clabe FROM col_payment_accounts WHERE id = c.cuenta_pago_id AND activa) a) AS cuenta
      FROM col_credits cr
      JOIN col_clients c ON c.id = cr.client_id
      JOIN col_credit_snapshots s ON s.credit_id = cr.id AND s.fecha_corte = ${fechaCorte}
      JOIN cliente k ON k.client_id = cr.client_id
      WHERE c.ambiente = ${ambiente} AND cr.en_listado
        AND s.proximo_vencimiento BETWEEN ${hoy}::date AND ${addDays(hoy, 5)}::date
      ORDER BY s.proximo_vencimiento, c.nombre
    `,
    sql`
      SELECT k.id, k.client_id, k.relacion, k.rol, k.tipo, k.telefono_whatsapp, k.estatus, k.baja_whatsapp_at, k.es_principal, k.nombre_contacto
      FROM col_contacts k JOIN col_clients c ON c.id = k.client_id
      WHERE c.ambiente = ${ambiente}
    `,
  ]);
  const enviados = new Set(
    (
      await sql`SELECT dedupe_key FROM col_wa_messages WHERE origen = 'recordatorio_preventivo' AND created_at > now() - interval '40 days'`
    ).map((r) => r.dedupe_key as string),
  );
  const montos = await montosGuardados(creditos.map((c) => ({ id: c.id, proximo_vencimiento: c.proximo_vencimiento, fecha_ultimo_pago: c.fecha_ultimo_pago })));
  const porCliente = new Map<string, PreventivoCandidate["contactos"]>();
  for (const k of contactos) {
    const lista = porCliente.get(k.client_id) ?? [];
    lista.push({
      id: k.id,
      relacion: k.relacion,
      rol: k.rol,
      tipo: k.tipo,
      telefonoWhatsapp: k.telefono_whatsapp,
      estatus: k.estatus,
      bajaWhatsappAt: k.baja_whatsapp_at ? String(k.baja_whatsapp_at) : null,
      esPrincipal: k.es_principal,
      nombre: k.nombre_contacto,
    });
    porCliente.set(k.client_id, lista);
  }
  return creditos.map((c) => {
    const etapa = (Object.keys(ETAPAS) as (keyof typeof ETAPAS)[]).find((e) => addDays(hoy, ETAPAS[e].dias) === c.proximo_vencimiento);
    return {
      creditId: c.id,
      clientId: c.client_id,
      noCredito: c.no_credito,
      nombre: c.nombre,
      proximoVencimiento: c.proximo_vencimiento,
      fechaUltimoPago: c.fecha_ultimo_pago,
      historial: { vecesMora: Number(c.veces), atrasoMaximo: Number(c.atraso) },
      enMora: Number(c.vencido) >= umbralMora,
      etapaManual: c.etapa_manual === "juridico" || c.etapa_manual === "reestructura" ? c.etapa_manual : null,
      pausaHasta: c.pausa_hasta,
      contactos: porCliente.get(c.client_id) ?? [],
      contactoCobranzaId: c.contacto_cobranza_id,
      yaSeIntento: etapa ? enviados.has(dedupeKey(c.id, etapa, c.proximo_vencimiento)) : false,
      monto: montos.get(c.id) ?? null,
      cuenta: c.cuenta,
    };
  });
}

const dedupeKey = (creditId: string, etapa: string, vencimiento: string) => `preventiva:${creditId}:${etapa}:${vencimiento}`;

export interface PreventivosPreview {
  ambiente: string;
  activado: boolean;
  hoy: string;
  fechaCorte: string | null;
  bloqueos: string[];
  bloqueosManual: string[];
  umbrales: UmbralesSemaforo;
  plantillas: PlantillaMora[];
  /** Los que vencen hoy, mañana o en 5 días (a los que hoy les toca recordatorio). */
  filas: { creditId: string; clientId: string; nombre: string; noCredito: string; proximoVencimiento: string; decision: PreventivoDecision }[];
  /** Los que vencen en 2 a 4 días: hoy no les toca, se muestran para planear. */
  proximos: { creditId: string; clientId: string; nombre: string; noCredito: string; proximoVencimiento: string; semaforo: Semaforo }[];
}

export async function previewPreventivos(): Promise<PreventivosPreview> {
  const hoy = fechaMexico();
  const [status, umbralMora, ajuste, ventana, plantillas, umbrales] = await Promise.all([
    getPhotoStatus(),
    getSetting("umbral_mora", UMBRAL_MORA_DEFAULT),
    getSetting<{ activo?: boolean }>("whatsapp_preventivo", {}),
    getSetting("ventana_envio", VENTANA_DEFAULT),
    plantillasDe("preventiva"),
    umbralesSemaforo(),
  ]);
  const activas = plantillas.filter((t) => t.activa).map((t) => t.nombre);
  const condiciones = {
    ambiente: status.ambiente,
    activado: ajuste.activo === true,
    configurado: getWhatsAppConfig() !== null,
    plantillasActivas: activas.length,
    fotoDeHoy: status.fechaCorte === hoy,
    hora: horaMexico(),
    ventana,
    queRecordatorio: "preventivas",
  };

  const filas: PreventivosPreview["filas"] = [];
  const proximos: PreventivosPreview["proximos"] = [];
  if (status.fechaCorte) {
    for (const c of await candidatos(status.fechaCorte, hoy, umbralMora)) {
      const decision = decidirPreventivo(c, { hoy, plantillasActivas: activas, umbrales });
      const base = { creditId: c.creditId, clientId: c.clientId, nombre: c.nombre, noCredito: c.noCredito, proximoVencimiento: c.proximoVencimiento! };
      if (decision) filas.push({ ...base, decision });
      else proximos.push({ ...base, semaforo: semaforo(c.historial, umbrales) });
    }
  }
  return {
    ambiente: status.ambiente,
    activado: ajuste.activo === true,
    hoy,
    fechaCorte: status.fechaCorte,
    bloqueos: bloqueosDeEnvio(condiciones),
    bloqueosManual: bloqueosDeEnvio({ ...condiciones, activado: true }),
    umbrales,
    plantillas,
    filas: filas.sort((a, b) => Number(b.decision.enviar) - Number(a.decision.enviar) || a.proximoVencimiento.localeCompare(b.proximoVencimiento)),
    proximos,
  };
}

/** Máximo de consultas a SIAC por corrida para obtener montos (SIAC pidió no hacer cargas masivas). */
export const MAX_CONSULTAS_MONTO = 15;

/**
 * Pregunta a SIAC el monto de la mensualidad de los créditos a los que hoy les
 * toca recordatorio y solo les falta eso: UNA consulta por crédito y
 * vencimiento (ConsultarSaldoCredito a la fecha de vencimiento), en serie y
 * con tope. Las consultas quedan en el expediente de cada cliente.
 * soloSiSeEnvia: el cron solo consulta si hoy de verdad se van a mandar.
 */
export async function obtenerMontosPreventivos(p: { actor: string; soloSiSeEnvia: boolean }): Promise<{ consultados: number; fallidos: number; pendientes: number; omitido: string | null }> {
  const preview = await previewPreventivos();
  if (p.soloSiSeEnvia && preview.bloqueos.length > 0) return { consultados: 0, fallidos: 0, pendientes: 0, omitido: preview.bloqueos.join("; ") };
  const faltan = preview.filas.filter((f) => !f.decision.enviar && f.decision.motivo === MOTIVO_FALTA_MONTO);
  let consultados = 0;
  let fallidos = 0;
  for (const f of faltan.slice(0, MAX_CONSULTAS_MONTO)) {
    try {
      await consultarSaldoAlDia({ clientId: f.clientId, creditId: f.creditId, fechaCorte: f.proximoVencimiento, actor: p.actor });
      consultados++;
    } catch (e) {
      fallidos++;
      console.error(`Preventivos: no se obtuvo el monto del crédito ${f.noCredito}: ${(e as Error).message}`);
    }
  }
  return { consultados, fallidos, pendientes: Math.max(0, faltan.length - MAX_CONSULTAS_MONTO), omitido: null };
}

/** Manda los preventivos de hoy. Mismos bloqueos que mora (pruebas, apagado, horario…). */
export async function runPreventivos(p: { disparadoPor: string; manual?: boolean }): Promise<MoraRunResult> {
  const preview = await previewPreventivos();
  const bloqueos = p.manual ? preview.bloqueosManual : preview.bloqueos;
  if (bloqueos.length > 0) return { bloqueos, enviados: 0, fallidos: 0, omitidos: 0, detenido: null };
  const porNombre = new Map(preview.plantillas.map((t) => [t.nombre, t]));
  return enviarLote({
    disparadoPor: p.disparadoPor,
    hoy: preview.hoy,
    origen: "recordatorio_preventivo",
    envios: preview.filas.map((f) =>
      f.decision.enviar
        ? {
            clientId: f.clientId,
            creditId: f.creditId,
            contactId: f.decision.contactId,
            telefono: f.decision.telefono,
            plantilla: porNombre.get(f.decision.plantilla)!,
            parametros: f.decision.parametros,
            dedupeKey: dedupeKey(f.creditId, f.decision.etapa, f.proximoVencimiento),
            descripcion: `Recordatorio preventivo por WhatsApp, ${ETAPAS[f.decision.etapa].etiqueta} (crédito ${f.noCredito}, vence ${f.proximoVencimiento})`,
          }
        : null,
    ),
  });
}

/** Prende o apaga el envío automático de preventivos. Solo Super Admin (se valida en la acción). */
export async function setEnvioPreventivoActivo(p: { activo: boolean; actor: string }) {
  await sql`
    INSERT INTO col_settings (key, value, descripcion, updated_by, updated_at)
    VALUES ('whatsapp_preventivo', ${JSON.stringify({ activo: p.activo })}::text::jsonb, 'Envío automático de recordatorios preventivos.', ${p.actor}, now())
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()
  `;
  await logAudit({
    actorEmail: p.actor,
    action: p.activo ? "cobranza_whatsapp_preventivo_encendido" : "cobranza_whatsapp_preventivo_apagado",
    entityType: "col_settings",
    entityId: "whatsapp_preventivo",
  });
}
