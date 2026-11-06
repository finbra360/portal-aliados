// Recordatorios de cobranza por correo (preventivos y mora). Las mismas reglas
// que el WhatsApp, con su propio interruptor. El backoffice arma cada correo, lo
// registra (sin duplicados) y se lo pasa a n8n en lotes; n8n lo manda con la
// cuenta de Gmail "Correo Cobranza" y responde cuál salió y cuál no.

import { sql, transaccion } from "@/lib/db";
import { logAudit } from "@/lib/db/audit";
import { getPhotoStatus, getUmbralesSemaforo } from "@/lib/db/collections";
import { getSetting, openAlert } from "@/lib/collections/store";
import { UMBRAL_MORA_DEFAULT, fechaMexico } from "@/lib/collections/rules";
import { bloqueosDeEnvio } from "@/lib/collections/whatsapp-mora";
import { diasCubiertos, esDiaHabil } from "@/lib/collections/dias-habiles";
import { correoPreventivo, decidirCorreoMora, decidirCorreoPreventivo, etiquetaEtapa, type CorreoDecision } from "@/lib/collections/correos";
import { HORARIO_DEFAULT_CORREO, MAX_CORREOS_POR_LOTE, MAX_PRUEBAS_CORREO_DIA } from "@/lib/collections/correos-config";
import { candidatosMora, horaMexico } from "@/lib/db/whatsapp-mora";
import { candidatosPreventivos } from "@/lib/db/whatsapp-preventivo";
import { enviarCorreosCobranza } from "@/lib/n8n";

export class CorreoCobranzaError extends Error {}

type Tipo = "mora" | "preventivo";
const AJUSTE: Record<Tipo, string> = { mora: "correo_mora", preventivo: "correo_preventivo" };

const dedupeMora = (clientId: string, hoy: string) => `correo-mora:${clientId}:${hoy}`;
const dedupePreventivo = (creditId: string, etapa: string, vencimiento: string) => `correo-preventiva:${creditId}:${etapa}:${vencimiento}`;

export interface CorreoReciente {
  id: number;
  clientId: string | null;
  cliente: string | null;
  destinatarios: string[];
  asunto: string;
  origen: string;
  estado: string;
  error: string | null;
  at: string;
}

export interface CorreosPreview {
  ambiente: string;
  hoy: string;
  fechaCorte: string | null;
  configurado: boolean;
  mora: {
    activado: boolean;
    bloqueos: string[];
    bloqueosManual: string[];
    filas: { clientId: string; nombre: string; totalVencido: number; decision: CorreoDecision }[];
  };
  preventivos: {
    activado: boolean;
    bloqueos: string[];
    bloqueosManual: string[];
    filas: { creditId: string; clientId: string; nombre: string; noCredito: string; proximoVencimiento: string; etapa: string; etiqueta: string; decision: CorreoDecision }[];
  };
  ultimos: CorreoReciente[];
}

/** Lo que pasaría si el envío de correos corriera ahora, sin mandar nada. */
export async function previewCorreos(): Promise<CorreosPreview> {
  const hoy = fechaMexico();
  const [status, umbral, ajusteMora, ajustePrev, ventana, umbrales, ya, ultimos] = await Promise.all([
    getPhotoStatus(),
    getSetting("umbral_mora", UMBRAL_MORA_DEFAULT),
    getSetting<{ activo?: boolean }>(AJUSTE.mora, {}),
    getSetting<{ activo?: boolean }>(AJUSTE.preventivo, {}),
    getSetting("ventana_envio", HORARIO_DEFAULT_CORREO),
    getUmbralesSemaforo(),
    sql`SELECT dedupe_key FROM col_email_messages WHERE origen <> 'prueba' AND created_at > now() - interval '40 days'`,
    ultimosCorreos(),
  ]);
  const enviados = new Set(ya.map((r) => r.dedupe_key as string));
  const configurado = Boolean(process.env.N8N_BASE_URL);
  const condiciones = (activado: boolean) => ({
    ambiente: status.ambiente,
    activado,
    configurado: true,
    plantillasActivas: 1,
    fotoDeHoy: status.fechaCorte === hoy,
    hora: horaMexico(),
    ventana,
    diaHabil: esDiaHabil(hoy),
  });
  const bloqueos = (activado: boolean) => {
    const b = bloqueosDeEnvio(condiciones(activado));
    if (!configurado) b.push("Falta N8N_BASE_URL en Vercel: no hay con qué mandar los correos");
    return b;
  };

  let filasMora: CorreosPreview["mora"]["filas"] = [];
  let filasPrev: CorreosPreview["preventivos"]["filas"] = [];
  if (status.fechaCorte) {
    const cubiertos = diasCubiertos(hoy);
    const [mora, prev] = await Promise.all([candidatosMora(status.fechaCorte, hoy), candidatosPreventivos(status.fechaCorte, hoy, umbral)]);
    filasMora = mora
      .filter((c) => c.totalVencido >= umbral)
      .map((c) => ({ clientId: c.clientId, nombre: c.nombre, totalVencido: c.totalVencido, decision: decidirCorreoMora(c, { umbral, hoy, yaSeEnvioHoy: enviados.has(dedupeMora(c.clientId, hoy)) }) }))
      .filter((f) => f.decision.enviar || f.decision.motivo !== "Vence hoy: todavía no está en mora")
      .sort((a, b) => Number(b.decision.enviar) - Number(a.decision.enviar) || b.totalVencido - a.totalVencido);
    for (const c of prev) {
      // Mismo cálculo de etapa que la decisión, para saber si ya se mandó.
      const tentativa = decidirCorreoPreventivo(c, { hoy, umbrales, cubiertos, yaSeEnvio: false });
      if (!tentativa) continue;
      const yaSeEnvio = enviados.has(dedupePreventivo(c.creditId, tentativa.etapa, c.proximoVencimiento!));
      const d = yaSeEnvio ? decidirCorreoPreventivo(c, { hoy, umbrales, cubiertos, yaSeEnvio })! : tentativa;
      filasPrev.push({
        creditId: c.creditId,
        clientId: c.clientId,
        nombre: c.nombre,
        noCredito: c.noCredito,
        proximoVencimiento: c.proximoVencimiento!,
        etapa: d.etapa,
        etiqueta: etiquetaEtapa(d.etapa, d.adelantado),
        decision: d,
      });
    }
    filasPrev = filasPrev.sort((a, b) => Number(b.decision.enviar) - Number(a.decision.enviar) || a.proximoVencimiento.localeCompare(b.proximoVencimiento));
  }

  return {
    ambiente: status.ambiente,
    hoy,
    fechaCorte: status.fechaCorte,
    configurado,
    mora: { activado: ajusteMora.activo === true, bloqueos: bloqueos(ajusteMora.activo === true), bloqueosManual: bloqueos(true), filas: filasMora },
    preventivos: { activado: ajustePrev.activo === true, bloqueos: bloqueos(ajustePrev.activo === true), bloqueosManual: bloqueos(true), filas: filasPrev },
    ultimos,
  };
}

export async function ultimosCorreos(): Promise<CorreoReciente[]> {
  const rows = await sql`
    SELECT m.id, m.client_id, c.nombre, m.destinatarios, m.asunto, m.origen, m.estado, m.error, m.created_at
    FROM col_email_messages m LEFT JOIN col_clients c ON c.id = m.client_id
    ORDER BY m.created_at DESC LIMIT 50
  `;
  return rows.map((m) => ({
    id: Number(m.id),
    clientId: m.client_id,
    cliente: m.client_id ? m.nombre : "Correo de prueba",
    destinatarios: m.destinatarios,
    asunto: m.asunto,
    origen: m.origen,
    estado: m.estado,
    error: m.error,
    at: (m.created_at as Date).toISOString(),
  }));
}

export interface CorreosRunResult {
  bloqueos: string[];
  enviados: number;
  fallidos: number;
  omitidos: number;
  detenido: string | null;
}

interface EnvioCorreo {
  clientId: string | null;
  creditId: string | null;
  destinatarios: string[];
  asunto: string;
  html: string;
  dedupeKey: string;
  /** Lo que queda en el historial del cliente. */
  descripcion: string;
}

/**
 * Registra cada correo (sin duplicados) y se los pasa a n8n en lotes. Un
 * rechazo abre la alerta mensaje_fallido del cliente; si n8n no responde, el
 * lote queda como fallido y se detiene (el problema es de todos).
 */
async function enviarCorreos(p: { disparadoPor: string; origen: "recordatorio_mora" | "recordatorio_preventivo" | "prueba"; envios: (EnvioCorreo | null)[] }): Promise<CorreosRunResult> {
  const result: CorreosRunResult = { bloqueos: [], enviados: 0, fallidos: 0, omitidos: 0, detenido: null };
  const maxEnvios = await getSetting("max_envios_mora_por_dia", 100);
  const registrados: (EnvioCorreo & { id: string })[] = [];
  for (const e of p.envios) {
    if (!e) {
      result.omitidos++;
      continue;
    }
    if (registrados.length >= maxEnvios) {
      result.detenido = `Se alcanzó el tope de ${maxEnvios} envíos por corrida`;
      break;
    }
    const [row] = await sql`
      INSERT INTO col_email_messages (client_id, credit_id, destinatarios, asunto, cuerpo_html, origen, dedupe_key, enviado_por)
      VALUES (${e.clientId}, ${e.creditId}, ${e.destinatarios}, ${e.asunto}, ${e.html}, ${p.origen}, ${e.dedupeKey}, ${p.disparadoPor})
      ON CONFLICT (dedupe_key) DO NOTHING
      RETURNING id
    `;
    if (!row) {
      result.omitidos++; // otra corrida ya lo registró
      continue;
    }
    registrados.push({ ...e, id: String(row.id) });
  }

  for (let i = 0; i < registrados.length; i += MAX_CORREOS_POR_LOTE) {
    const lote = registrados.slice(i, i + MAX_CORREOS_POR_LOTE);
    let resultados: Awaited<ReturnType<typeof enviarCorreosCobranza>>;
    try {
      resultados = await enviarCorreosCobranza(lote.map((e) => ({ id: e.id, to: e.destinatarios.join(","), subject: e.asunto, html: e.html })));
    } catch (err) {
      const mensaje = `n8n no pudo mandar los correos: ${(err as Error).message}`;
      const pendientes = registrados.slice(i).map((e) => e.id);
      await sql`UPDATE col_email_messages SET estado = 'fallido', error = ${mensaje}, estado_actualizado_at = now() WHERE id = ANY(${pendientes}::bigint[])`;
      result.fallidos += pendientes.length;
      result.detenido = mensaje;
      break;
    }
    const porId = new Map(resultados.map((r) => [String(r.id), r]));
    for (const e of lote) {
      const r = porId.get(e.id);
      if (r?.ok) {
        result.enviados++;
        await transaccion(async (tx) => {
          await tx`UPDATE col_email_messages SET estado = 'enviado', gmail_id = ${r.gmailId ?? null}, estado_actualizado_at = now() WHERE id = ${e.id}`;
          if (e.clientId) {
            await tx`
              INSERT INTO col_activities (client_id, credit_id, tipo, descripcion, metadata, actor)
              VALUES (${e.clientId}, ${e.creditId}, 'correo', ${e.descripcion},
                      ${JSON.stringify({ correoId: Number(e.id), destinatarios: e.destinatarios, asunto: e.asunto })}::text::jsonb, 'sistema')
            `;
          }
        });
      } else {
        result.fallidos++;
        const error = r?.error || "n8n no confirmó el envío de este correo";
        await transaccion(async (tx) => {
          await tx`UPDATE col_email_messages SET estado = 'fallido', error = ${error}, estado_actualizado_at = now() WHERE id = ${e.id}`;
          if (e.clientId) {
            await openAlert(tx, e.clientId, e.creditId, {
              tipo: "mensaje_fallido",
              severidad: "atencion",
              dedupeKey: `mensaje_fallido:${e.clientId}`,
              detalle: { canal: "correo", error, destinatarios: e.destinatarios },
            });
          }
        });
      }
    }
  }
  return result;
}

/** Manda los correos de mora de hoy. `manual`: lo pidió un Super Admin; ignora solo el interruptor. */
export async function runCorreosMora(p: { disparadoPor: string; manual?: boolean }): Promise<CorreosRunResult> {
  const preview = await previewCorreos();
  const bloqueos = p.manual ? preview.mora.bloqueosManual : preview.mora.bloqueos;
  if (bloqueos.length > 0) return { bloqueos, enviados: 0, fallidos: 0, omitidos: 0, detenido: null };
  return enviarCorreos({
    disparadoPor: p.disparadoPor,
    origen: "recordatorio_mora",
    envios: preview.mora.filas.map((f) =>
      f.decision.enviar
        ? {
            clientId: f.clientId,
            creditId: null,
            destinatarios: f.decision.destinatarios,
            asunto: f.decision.asunto,
            html: f.decision.html,
            dedupeKey: dedupeMora(f.clientId, preview.hoy),
            descripcion: `Recordatorio de mora por correo a ${f.decision.destinatarios.join(", ")}`,
          }
        : null,
    ),
  });
}

/** Manda los correos preventivos de hoy (con lo que se adelanta de los días inhábiles siguientes). */
export async function runCorreosPreventivos(p: { disparadoPor: string; manual?: boolean }): Promise<CorreosRunResult> {
  const preview = await previewCorreos();
  const bloqueos = p.manual ? preview.preventivos.bloqueosManual : preview.preventivos.bloqueos;
  if (bloqueos.length > 0) return { bloqueos, enviados: 0, fallidos: 0, omitidos: 0, detenido: null };
  return enviarCorreos({
    disparadoPor: p.disparadoPor,
    origen: "recordatorio_preventivo",
    envios: preview.preventivos.filas.map((f) =>
      f.decision.enviar
        ? {
            clientId: f.clientId,
            creditId: f.creditId,
            destinatarios: f.decision.destinatarios,
            asunto: f.decision.asunto,
            html: f.decision.html,
            dedupeKey: dedupePreventivo(f.creditId, f.etapa, f.proximoVencimiento),
            descripcion: `Recordatorio preventivo por correo, ${f.etiqueta} (crédito ${f.noCredito}, vence ${f.proximoVencimiento}) a ${f.decision.destinatarios.join(", ")}`,
          }
        : null,
    ),
  });
}

/**
 * Manda a `para` un correo de ejemplo (preventivo del día, datos ficticios y la
 * primera cuenta de pago activa), para ver cómo le llega al cliente. Funciona
 * aunque el envío esté apagado. Máximo MAX_PRUEBAS_CORREO_DIA al día.
 */
export async function enviarCorreoPrueba(p: { para: string; actor: string }): Promise<CorreosRunResult> {
  const [{ n }] = await sql`SELECT count(*)::int AS n FROM col_email_messages WHERE origen = 'prueba' AND created_at > now() - interval '1 day'`;
  if (n >= MAX_PRUEBAS_CORREO_DIA) throw new CorreoCobranzaError(`Ya se mandaron ${MAX_PRUEBAS_CORREO_DIA} correos de prueba en las últimas 24 horas`);
  const [cuenta] = await sql`SELECT banco, beneficiario, clabe FROM col_payment_accounts WHERE activa ORDER BY created_at LIMIT 1`;
  if (!cuenta) throw new CorreoCobranzaError("No hay cuentas de pago activas para el ejemplo");
  const hoy = fechaMexico();
  const correo = correoPreventivo({
    textoEtapa: "dia",
    cliente: "PRUEBA FINBRA S.A. DE C.V.",
    noCredito: "0000",
    monto: 1234.56,
    vencimiento: hoy,
    cuenta: { banco: cuenta.banco, beneficiario: cuenta.beneficiario, clabe: cuenta.clabe },
  });
  const r = await enviarCorreos({
    disparadoPor: p.actor,
    origen: "prueba",
    envios: [
      {
        clientId: null,
        creditId: null,
        destinatarios: [p.para],
        asunto: `[Prueba] ${correo.asunto}`,
        html: correo.html,
        dedupeKey: `prueba:${Date.now()}`,
        descripcion: "Correo de prueba",
      },
    ],
  });
  await logAudit({ actorEmail: p.actor, action: "cobranza_correo_prueba", entityType: "col_email_messages", metadata: { enviados: r.enviados, fallidos: r.fallidos } });
  return r;
}

/** Prende o apaga el envío automático de correos de mora o preventivos. Solo Super Admin (se valida en la acción). */
export async function setCorreoActivo(p: { tipo: Tipo; activo: boolean; actor: string }) {
  const key = AJUSTE[p.tipo];
  await sql`
    INSERT INTO col_settings (key, value, descripcion, updated_by, updated_at)
    VALUES (${key}, ${JSON.stringify({ activo: p.activo })}::text::jsonb, ${`Envío automático de correos ${p.tipo === "mora" ? "de mora" : "preventivos"}.`}, ${p.actor}, now())
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()
  `;
  await logAudit({ actorEmail: p.actor, action: `cobranza_${key}_${p.activo ? "encendido" : "apagado"}`, entityType: "col_settings", entityId: key });
}
