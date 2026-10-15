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
  decidirPreventivo,
  semaforo,
  type PreventivoCandidate,
  type PreventivoDecision,
  type Semaforo,
  type UmbralesSemaforo,
} from "@/lib/collections/preventivos";
import { getWhatsAppConfig } from "@/lib/whatsapp/client";
import { enviarLote, plantillasDe, type MoraRunResult, type PlantillaMora } from "@/lib/db/whatsapp-mora";

const VENTANA_DEFAULT = { desde: "09:00", hasta: "19:00" };

const horaMexico = (d = new Date()) =>
  new Intl.DateTimeFormat("en-GB", { timeZone: "America/Mexico_City", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(d);

/**
 * Monto de la próxima mensualidad según SIAC. Hoy SIAC no lo da en
 * ListadoCobranzaJSON ni en ConsultarSaldoCredito; está pendiente el "Listado
 * Cobranza Personalizado" (o permiso para ConsultarSaldoCredito a la fecha de
 * vencimiento). Mientras tanto regresa null y el preventivo no sale.
 */
const MONTO_DISPONIBLE = false;

async function montosDeSiac(_creditIds: string[]): Promise<Map<string, number>> {
  return new Map();
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
             k.vencido, k.veces, k.atraso
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
  const montos = await montosDeSiac(creditos.map((c) => c.id));
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
  const sinMonto = MONTO_DISPONIBLE ? [] : ["Falta el monto de la mensualidad: SIAC todavía no lo da (Listado Personalizado pendiente)"];

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
    bloqueos: [...sinMonto, ...bloqueosDeEnvio(condiciones)],
    bloqueosManual: [...sinMonto, ...bloqueosDeEnvio({ ...condiciones, activado: true })],
    umbrales,
    plantillas,
    filas: filas.sort((a, b) => Number(b.decision.enviar) - Number(a.decision.enviar) || a.proximoVencimiento.localeCompare(b.proximoVencimiento)),
    proximos,
  };
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
