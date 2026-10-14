// Recordatorios de mora por WhatsApp: vista previa, envío diario y ajustes.
// Cada mensaje se registra en col_wa_messages ANTES de llamar a Meta, con una
// dedupe_key única por cliente y día: un segundo intento el mismo día falla en
// la base y nunca llega a Meta.

import { sql } from "@/lib/db";
import { logAudit } from "@/lib/db/audit";
import { ambienteActual, getPhotoStatus } from "@/lib/db/collections";
import { getSetting, openAlert, peso } from "@/lib/collections/store";
import { UMBRAL_MORA_DEFAULT, fechaMexico, normalizePhoneMx } from "@/lib/collections/rules";
import {
  bloqueosDeEnvio,
  decidirMora,
  estadoDesdeMeta,
  motivoNoActivable,
  parametrosDePrueba,
  renderPlantilla,
  type MoraCandidate,
  type MoraDecision,
} from "@/lib/collections/whatsapp-mora";
import {
  WhatsAppError,
  consultarNumero,
  consultarPlantillas,
  enviarPlantilla,
  esErrorGeneral,
  getWhatsAppConfig,
  obtenerCuentaWhatsApp,
  type NumeroMeta,
} from "@/lib/whatsapp/client";

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
  /** Lo último que dijo Meta ("Revisar con Meta"). */
  estadoMeta: string;
  cuerpo: string | null;
  motivoRechazo: string | null;
  revisadaAt: string | null;
}

async function plantillasMora(): Promise<PlantillaMora[]> {
  const rows = await sql`
    SELECT id, nombre, idioma, activa, orden, estado_meta, cuerpo, motivo_rechazo, meta_revisada_at
    FROM col_wa_templates WHERE uso = 'mora' ORDER BY orden, nombre
  `;
  return rows.map((r) => ({
    id: r.id,
    nombre: r.nombre,
    idioma: r.idioma,
    activa: r.activa,
    orden: r.orden,
    estadoMeta: r.estado_meta,
    cuerpo: r.cuerpo,
    motivoRechazo: r.motivo_rechazo,
    revisadaAt: r.meta_revisada_at ? (r.meta_revisada_at as Date).toISOString() : null,
  }));
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
  /** Resultado de la última "Revisar con Meta", o null si nunca se ha hecho. */
  revisionMeta: (NumeroMeta & { at: string; por: string }) | null;
}

/** Lo que pasaría si el envío corriera ahora, sin mandar nada. */
export async function previewMora(): Promise<MoraPreview> {
  const hoy = fechaMexico();
  const [status, umbral, ajuste, ventana, plantillas, revisionMeta] = await Promise.all([
    getPhotoStatus(),
    getSetting("umbral_mora", UMBRAL_MORA_DEFAULT),
    getSetting<{ activo?: boolean }>("whatsapp_mora", {}),
    getSetting("ventana_envio", VENTANA_DEFAULT),
    plantillasMora(),
    getSetting<MoraPreview["revisionMeta"]>("whatsapp_revision_meta", null),
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
    WHERE m.origen IN ('recordatorio_mora', 'backoffice_manual')
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
      cliente: m.client_id ? m.nombre : "Envío de prueba",
      telefono: m.telefono,
      plantilla: m.plantilla,
      estado: m.estado,
      error: m.error,
      at: (m.created_at as Date).toISOString(),
    })),
    revisionMeta,
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

/** Mete una plantilla a la rotación (solo si Meta la aprobó y tiene las 6 variables) o la saca. */
export async function setPlantillaActiva(p: { id: number; activa: boolean; actor: string }) {
  const [t] = await sql`SELECT estado_meta, cuerpo FROM col_wa_templates WHERE id = ${p.id} AND uso = 'mora'`;
  if (!t) throw new WhatsAppMoraError("No encontramos esa plantilla");
  if (p.activa) {
    const motivo = motivoNoActivable({ estadoMeta: t.estado_meta, cuerpo: t.cuerpo });
    if (motivo) throw new WhatsAppMoraError(motivo);
  }
  await sql`UPDATE col_wa_templates SET activa = ${p.activa}, updated_by = ${p.actor}, updated_at = now() WHERE id = ${p.id}`;
  await logAudit({ actorEmail: p.actor, action: p.activa ? "cobranza_plantilla_activada" : "cobranza_plantilla_desactivada", entityType: "col_wa_templates", entityId: String(p.id) });
}

export interface RevisionMeta {
  numero: NumeroMeta;
  avisos: string[];
}

/**
 * Comprueba el token y el número, y trae de Meta el estado y el texto de las
 * plantillas de mora. No envía nada. Una plantilla activa que Meta ya no tiene
 * aprobada (o que cambió de número de variables) sale de la rotación.
 */
export async function revisarConMeta(p: { actor: string }): Promise<RevisionMeta> {
  const config = getWhatsAppConfig();
  if (!config) throw new WhatsAppMoraError("Faltan las variables de WhatsApp en Vercel (WHATSAPP_TOKEN y WHATSAPP_PHONE_NUMBER_ID)");

  // El número se guarda en cuanto responde: aunque las plantillas fallen,
  // queda comprobado que el token y el número funcionan.
  const numero = await consultarNumero(config);
  const revision = { ...numero, at: new Date().toISOString(), por: p.actor };
  await sql`
    INSERT INTO col_settings (key, value, descripcion, updated_by, updated_at)
    VALUES ('whatsapp_revision_meta', ${JSON.stringify(revision)}::text::jsonb, 'Última revisión de la conexión con Meta (número y plantillas).', ${p.actor}, now())
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()
  `;

  const locales = await plantillasMora();
  let enMeta;
  try {
    const cuentaId = await obtenerCuentaWhatsApp(config);
    enMeta = await consultarPlantillas(config, cuentaId, locales.map((t) => t.nombre));
  } catch (e) {
    if (!(e instanceof WhatsAppError)) throw e;
    const avisos = [`No se pudieron revisar las plantillas: ${e.message}`];
    await logAudit({ actorEmail: p.actor, action: "cobranza_whatsapp_revision_meta", entityType: "col_wa_templates", metadata: { avisos } });
    return { numero, avisos };
  }

  const avisos: string[] = [];
  for (const t of locales) {
    const versiones = enMeta.filter((m) => m.nombre === t.nombre);
    const m = versiones.find((v) => v.idioma === t.idioma) ?? versiones.find((v) => v.idioma.startsWith("es")) ?? versiones[0];
    if (!m) {
      avisos.push(`${t.nombre}: no existe en Meta${t.activa ? "; se sacó de la rotación" : ""}`);
      await sql`
        UPDATE col_wa_templates SET estado_meta = 'pendiente', cuerpo = NULL, motivo_rechazo = NULL, activa = false, meta_revisada_at = now()
        WHERE id = ${t.id}
      `;
      continue;
    }
    const estado = estadoDesdeMeta(m.estado);
    const motivo = motivoNoActivable({ estadoMeta: estado, cuerpo: m.cuerpo });
    const sigueActiva = t.activa && !motivo;
    // Un aviso por plantilla: lo que impide usarla, con el motivo de Meta si lo dio.
    const conMotivoMeta = motivo && m.motivoRechazo ? `${motivo.replace(/.$/, "")} (${m.motivoRechazo}).` : motivo;
    if (t.activa && motivo) avisos.push(`${t.nombre}: ${conMotivoMeta} Se sacó de la rotación.`);
    else if (motivo && estado !== "pendiente") avisos.push(`${t.nombre}: ${conMotivoMeta}`);
    await sql`
      UPDATE col_wa_templates SET estado_meta = ${estado}, idioma = ${m.idioma}, categoria = coalesce(${m.categoria}, categoria),
             cuerpo = ${m.cuerpo}, motivo_rechazo = ${m.motivoRechazo}, activa = ${sigueActiva}, meta_revisada_at = now()
      WHERE id = ${t.id}
    `;
  }

  await logAudit({ actorEmail: p.actor, action: "cobranza_whatsapp_revision_meta", entityType: "col_wa_templates", metadata: { avisos } });
  return { numero, avisos };
}

const MAX_PRUEBAS_POR_DIA = 10;

/**
 * Manda una plantilla de mora aprobada a un número que escribe un Super Admin,
 * con valores de ejemplo (nunca datos de un cliente) y la primera cuenta de
 * pago activa. No pasa por los bloqueos del envío diario: es para probar.
 */
export async function enviarPrueba(p: { telefono: string; plantillaId: number; actor: string }): Promise<{ texto: string | null }> {
  const config = getWhatsAppConfig();
  if (!config) throw new WhatsAppMoraError("Faltan las variables de WhatsApp en Vercel");
  const telefono = normalizePhoneMx(p.telefono);
  if (!telefono) throw new WhatsAppMoraError("El teléfono debe tener 10 dígitos");

  const [t] = await sql`SELECT id, nombre, idioma, estado_meta, cuerpo FROM col_wa_templates WHERE id = ${p.plantillaId} AND uso = 'mora'`;
  if (!t) throw new WhatsAppMoraError("No encontramos esa plantilla");
  const motivo = motivoNoActivable({ estadoMeta: t.estado_meta, cuerpo: t.cuerpo });
  if (motivo) throw new WhatsAppMoraError(motivo);

  const [cuenta] = await sql`SELECT banco, beneficiario, clabe FROM col_payment_accounts WHERE activa ORDER BY created_at LIMIT 1`;
  if (!cuenta) throw new WhatsAppMoraError("Da de alta una cuenta de pago primero: la prueba usa sus datos");
  const [{ n }] = await sql`
    SELECT count(*)::int AS n FROM col_wa_messages
    WHERE origen = 'backoffice_manual' AND (created_at AT TIME ZONE 'America/Mexico_City')::date = ${fechaMexico()}::date
  `;
  if (n >= MAX_PRUEBAS_POR_DIA) throw new WhatsAppMoraError(`Ya se hicieron ${MAX_PRUEBAS_POR_DIA} envíos de prueba hoy`);

  const parametros = parametrosDePrueba({ banco: cuenta.banco, beneficiario: cuenta.beneficiario, clabe: cuenta.clabe });
  const [msg] = await sql`
    INSERT INTO col_wa_messages (direccion, telefono, tipo, template_id, parametros, estado, origen, enviado_por)
    VALUES ('saliente', ${telefono}, 'plantilla', ${t.id}, ${JSON.stringify(parametros)}::text::jsonb, 'pendiente', 'backoffice_manual', ${p.actor})
    RETURNING id
  `;
  try {
    const { wamid } = await enviarPlantilla(config, { telefono, plantilla: t.nombre, idioma: t.idioma, parametros });
    await sql`UPDATE col_wa_messages SET estado = 'enviado', wamid = ${wamid}, estado_actualizado_at = now() WHERE id = ${msg.id}`;
  } catch (e) {
    const err = e instanceof WhatsAppError ? e : new WhatsAppError((e as Error).message, null, {});
    await sql`UPDATE col_wa_messages SET estado = 'fallido', error = ${JSON.stringify(err.detalle)}::text::jsonb, estado_actualizado_at = now() WHERE id = ${msg.id}`;
    throw new WhatsAppMoraError(err.message);
  } finally {
    await logAudit({ actorEmail: p.actor, action: "cobranza_whatsapp_prueba", entityType: "col_wa_messages", entityId: String(msg.id), metadata: { plantilla: t.nombre } });
  }
  return { texto: t.cuerpo ? renderPlantilla(t.cuerpo, parametros) : null };
}
