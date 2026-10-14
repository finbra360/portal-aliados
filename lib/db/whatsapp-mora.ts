// Recordatorios de mora por WhatsApp: vista previa, envío diario y ajustes.
// Cada mensaje se registra en col_wa_messages ANTES de llamar a Meta, con una
// dedupe_key única por cliente y día: un segundo intento el mismo día falla en
// la base y nunca llega a Meta.

import { sql } from "@/lib/db";
import { logAudit } from "@/lib/db/audit";
import { ambienteActual, getPhotoStatus } from "@/lib/db/collections";
import { getSetting, openAlert, peso } from "@/lib/collections/store";
import { UMBRAL_MORA_DEFAULT, fechaMexico } from "@/lib/collections/rules";
import { bloqueosDeEnvio, decidirMora, type MoraCandidate, type MoraDecision } from "@/lib/collections/whatsapp-mora";
import { WhatsAppError, enviarPlantilla, esErrorGeneral, getWhatsAppConfig } from "@/lib/whatsapp/client";

export class WhatsAppMoraError extends Error {}

const VENTANA_DEFAULT = { desde: "09:00", hasta: "19:00" };
const MAX_ENVIOS_DEFAULT = 100;
const PAUSA_ENTRE_ENVIOS_MS = 250;

const horaMexico = (d = new Date()) =>
  new Intl.DateTimeFormat("en-GB", { timeZone: "America/Mexico_City", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(d);

export interface PlantillaMora {
  id: number;
  nombre: string;
  idioma: string;
  activa: boolean;
  orden: number;
}

async function plantillasMora(): Promise<PlantillaMora[]> {
  const rows = await sql`SELECT id, nombre, idioma, activa, orden FROM col_wa_templates WHERE uso = 'mora' ORDER BY orden, nombre`;
  return rows.map((r) => ({ id: r.id, nombre: r.nombre, idioma: r.idioma, activa: r.activa, orden: r.orden }));
}

/** Clientes con saldo vencido en la foto, con todo lo que decide si reciben recordatorio. */
async function candidatos(fechaCorte: string, hoy: string): Promise<MoraCandidate[]> {
  const ambiente = ambienteActual();
  const [clientes, contactos] = await Promise.all([
    sql`
      SELECT c.id, c.nombre, to_char(c.pausa_hasta, 'YYYY-MM-DD') AS pausa_hasta, c.contacto_cobranza_id,
             sum(s.total_vencido) AS total_vencido,
             json_agg(json_build_object('noCredito', cr.no_credito, 'totalVencido', s.total_vencido) ORDER BY s.total_vencido DESC) AS creditos,
             (array_agg(cr.etapa_manual ORDER BY cr.etapa_manual = 'juridico' DESC) FILTER (WHERE cr.etapa_manual IN ('juridico', 'reestructura')))[1] AS etapa,
             EXISTS (SELECT 1 FROM col_promises p WHERE p.client_id = c.id AND p.estado = 'vigente') AS promesa_vigente,
             (SELECT row_to_json(a) FROM (SELECT banco, beneficiario, clabe FROM col_payment_accounts WHERE id = c.cuenta_pago_id AND activa) a) AS cuenta,
             EXISTS (SELECT 1 FROM col_wa_messages m WHERE m.dedupe_key = 'mora:' || c.id || ':' || ${hoy}::text) AS ya_hoy,
             (SELECT t.nombre FROM col_wa_messages m JOIN col_wa_templates t ON t.id = m.template_id
               WHERE m.client_id = c.id AND m.origen = 'recordatorio_mora' AND m.estado <> 'fallido'
               ORDER BY m.created_at DESC LIMIT 1) AS ultima_plantilla
      FROM col_clients c
      JOIN col_credits cr ON cr.client_id = c.id
      JOIN col_credit_snapshots s ON s.credit_id = cr.id AND s.fecha_corte = ${fechaCorte}
      WHERE c.ambiente = ${ambiente}
      GROUP BY c.id
      HAVING sum(s.total_vencido) > 0
    `,
    sql`
      SELECT k.id, k.client_id, k.relacion, k.rol, k.tipo, k.telefono_whatsapp, k.estatus, k.baja_whatsapp_at, k.es_principal, k.nombre_contacto
      FROM col_contacts k JOIN col_clients c ON c.id = k.client_id
      WHERE c.ambiente = ${ambiente}
    `,
  ]);
  const porCliente = new Map<string, MoraCandidate["contactos"]>();
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
  return clientes.map((c) => ({
    clientId: c.id,
    nombre: c.nombre,
    totalVencido: Number(c.total_vencido),
    creditos: (c.creditos as { noCredito: string; totalVencido: number | string }[]).map((x) => ({ noCredito: x.noCredito, totalVencido: Number(x.totalVencido) })),
    pausaHasta: c.pausa_hasta,
    etapa: c.etapa,
    promesaVigente: c.promesa_vigente,
    cuenta: c.cuenta,
    contactos: porCliente.get(c.id) ?? [],
    contactoCobranzaId: c.contacto_cobranza_id,
    yaSeIntentoHoy: c.ya_hoy,
    ultimaPlantilla: c.ultima_plantilla,
  }));
}

export interface MoraPreview {
  ambiente: string;
  activado: boolean;
  configurado: boolean;
  ventana: { desde: string; hasta: string };
  hoy: string;
  fechaCorte: string | null;
  /** Por qué no saldría nada en la corrida automática. */
  bloqueos: string[];
  /** Lo mismo para un envío manual de Super Admin: ignora solo el interruptor. */
  bloqueosManual: string[];
  plantillas: PlantillaMora[];
  filas: { clientId: string; nombre: string; totalVencido: number; decision: MoraDecision }[];
  ultimos: { id: number; clientId: string | null; cliente: string | null; telefono: string; plantilla: string | null; estado: string; error: string | null; at: string }[];
}

/** Lo que pasaría si el envío corriera ahora, sin mandar nada. */
export async function previewMora(): Promise<MoraPreview> {
  const hoy = fechaMexico();
  const [status, umbral, ajuste, ventana, plantillas] = await Promise.all([
    getPhotoStatus(),
    getSetting("umbral_mora", UMBRAL_MORA_DEFAULT),
    getSetting<{ activo?: boolean }>("whatsapp_mora", {}),
    getSetting("ventana_envio", VENTANA_DEFAULT),
    plantillasMora(),
  ]);
  const activas = plantillas.filter((p) => p.activa).map((p) => p.nombre);
  const fotoDeHoy = status.fechaCorte === hoy;
  const condiciones = {
    ambiente: status.ambiente,
    activado: ajuste.activo === true,
    configurado: getWhatsAppConfig() !== null,
    plantillasActivas: activas.length,
    fotoDeHoy,
    hora: horaMexico(),
    ventana,
  };
  const bloqueos = bloqueosDeEnvio(condiciones);
  const bloqueosManual = bloqueosDeEnvio({ ...condiciones, activado: true });

  const filas = status.fechaCorte
    ? (await candidatos(status.fechaCorte, hoy))
        .map((c) => ({ clientId: c.clientId, nombre: c.nombre, totalVencido: c.totalVencido, decision: decidirMora(c, { umbral, hoy, plantillasActivas: activas }) }))
        .filter((f) => f.totalVencido >= umbral)
        .sort((a, b) => Number(b.decision.enviar) - Number(a.decision.enviar) || b.totalVencido - a.totalVencido)
    : [];

  const ultimos = await sql`
    SELECT m.id, m.client_id, c.nombre, m.telefono, t.nombre AS plantilla, m.estado, m.error->>'mensaje' AS error, m.created_at
    FROM col_wa_messages m
    LEFT JOIN col_clients c ON c.id = m.client_id
    LEFT JOIN col_wa_templates t ON t.id = m.template_id
    WHERE m.origen = 'recordatorio_mora'
    ORDER BY m.created_at DESC LIMIT 50
  `;
  return {
    ambiente: status.ambiente,
    activado: ajuste.activo === true,
    configurado: getWhatsAppConfig() !== null,
    ventana,
    hoy,
    fechaCorte: status.fechaCorte,
    bloqueos,
    bloqueosManual,
    plantillas,
    filas,
    ultimos: ultimos.map((m) => ({
      id: Number(m.id),
      clientId: m.client_id,
      cliente: m.nombre,
      telefono: m.telefono,
      plantilla: m.plantilla,
      estado: m.estado,
      error: m.error,
      at: (m.created_at as Date).toISOString(),
    })),
  };
}

export interface MoraRunResult {
  bloqueos: string[];
  enviados: number;
  fallidos: number;
  omitidos: number;
  detenido: string | null;
}

/**
 * Manda los recordatorios de mora de hoy. Si hay un bloqueo (ambiente de
 * pruebas, envío apagado, fuera de horario…) no manda nada. `manual`: lo pidió
 * un Super Admin desde la pantalla; ignora solo el interruptor de envío automático. Si Meta rechaza
 * por la plantilla o el token, se detiene: el problema afecta a todos.
 */
export async function runMoraReminders(p: { disparadoPor: string; manual?: boolean }): Promise<MoraRunResult> {
  const preview = await previewMora();
  const bloqueos = p.manual ? preview.bloqueosManual : preview.bloqueos;
  const result: MoraRunResult = { bloqueos, enviados: 0, fallidos: 0, omitidos: 0, detenido: null };
  if (bloqueos.length > 0) return result;

  const config = getWhatsAppConfig()!;
  const maxEnvios = await getSetting("max_envios_mora_por_dia", MAX_ENVIOS_DEFAULT);
  const porNombre = new Map(preview.plantillas.map((t) => [t.nombre, t]));

  for (const fila of preview.filas) {
    const d = fila.decision;
    if (!d.enviar) {
      result.omitidos++;
      continue;
    }
    if (result.enviados + result.fallidos >= maxEnvios) {
      result.detenido = `Se alcanzó el tope de ${maxEnvios} envíos por día`;
      break;
    }
    const plantilla = porNombre.get(d.plantilla)!;
    const [msg] = await sql`
      INSERT INTO col_wa_messages (client_id, contact_id, direccion, telefono, tipo, template_id, parametros, estado, origen, dedupe_key, enviado_por)
      VALUES (${fila.clientId}, ${d.contactId}, 'saliente', ${d.telefono}, 'plantilla', ${plantilla.id}, ${JSON.stringify(d.parametros)}::text::jsonb,
              'pendiente', 'recordatorio_mora', ${`mora:${fila.clientId}:${preview.hoy}`}, ${p.disparadoPor})
      ON CONFLICT (dedupe_key) DO NOTHING
      RETURNING id
    `;
    if (!msg) {
      result.omitidos++; // otra corrida ya lo registró hoy
      continue;
    }

    try {
      const { wamid } = await enviarPlantilla(config, { telefono: d.telefono, plantilla: plantilla.nombre, idioma: plantilla.idioma, parametros: d.parametros });
      await sql.begin(async (tx) => {
        await tx`UPDATE col_wa_messages SET estado = 'enviado', wamid = ${wamid}, estado_actualizado_at = now() WHERE id = ${msg.id}`;
        await tx`
          INSERT INTO col_activities (client_id, tipo, descripcion, wa_message_id, metadata, actor)
          VALUES (${fila.clientId}, 'whatsapp_enviado', ${`Recordatorio de mora por WhatsApp (${plantilla.nombre}): vencido ${peso(fila.totalVencido)}`},
                  ${msg.id}, ${JSON.stringify({ plantilla: plantilla.nombre })}::text::jsonb, 'sistema')
        `;
      });
      result.enviados++;
    } catch (e) {
      const err = e instanceof WhatsAppError ? e : new WhatsAppError((e as Error).message, null, {});
      result.fallidos++;
      await sql.begin(async (tx) => {
        await tx`UPDATE col_wa_messages SET estado = 'fallido', error = ${JSON.stringify(err.detalle)}::text::jsonb, estado_actualizado_at = now() WHERE id = ${msg.id}`;
        await openAlert(tx, fila.clientId, null, {
          tipo: "mensaje_fallido",
          severidad: "atencion",
          dedupeKey: `mensaje_fallido:${fila.clientId}`,
          detalle: { error: err.message, plantilla: plantilla.nombre, fecha: preview.hoy },
        });
      });
      if (esErrorGeneral(err.code)) {
        result.detenido = `Se detuvo el envío: ${err.message}`;
        break;
      }
    }
    await new Promise((ok) => setTimeout(ok, PAUSA_ENTRE_ENVIOS_MS));
  }
  return result;
}

/** Prende o apaga el envío automático. Solo Super Admin (se valida en la acción). */
export async function setEnvioMoraActivo(p: { activo: boolean; actor: string }) {
  await sql`
    INSERT INTO col_settings (key, value, descripcion, updated_by, updated_at)
    VALUES ('whatsapp_mora', ${JSON.stringify({ activo: p.activo })}::text::jsonb, 'Envío automático de recordatorios de mora por WhatsApp.', ${p.actor}, now())
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()
  `;
  await logAudit({ actorEmail: p.actor, action: p.activo ? "cobranza_whatsapp_mora_encendido" : "cobranza_whatsapp_mora_apagado", entityType: "col_settings", entityId: "whatsapp_mora" });
}

/** Activa una plantilla cuando Meta ya la aprobó, o la saca de la rotación. */
export async function setPlantillaActiva(p: { id: number; activa: boolean; actor: string }) {
  const r = await sql`
    UPDATE col_wa_templates SET activa = ${p.activa}, estado_meta = CASE WHEN ${p.activa} THEN 'aprobada' ELSE estado_meta END,
           updated_by = ${p.actor}, updated_at = now()
    WHERE id = ${p.id} AND uso = 'mora'
  `;
  if (r.count === 0) throw new WhatsAppMoraError("No encontramos esa plantilla");
  await logAudit({ actorEmail: p.actor, action: p.activa ? "cobranza_plantilla_activada" : "cobranza_plantilla_desactivada", entityType: "col_wa_templates", entityId: String(p.id) });
}
