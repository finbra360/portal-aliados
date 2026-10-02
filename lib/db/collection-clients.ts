// Perfil de un cliente de cobranza: lectura y cambios a sus contactos. Toda
// escritura deja una entrada en el timeline (col_activities) y en audit_log.

import { sql } from "@/lib/db";
import { logAudit } from "@/lib/db/audit";
import { ambienteActual } from "@/lib/db/collections";
import {
  TIPOS_CONTACTO,
  chooseRecipient,
  motivoNoRecibe,
  tipoDe,
  validarContactoNuevo,
  type ContactLike,
  type Recipient,
  type TipoContacto,
} from "@/lib/collections/contacts";
import type { Tx } from "@/lib/collections/store";

export interface ProfileContact extends ContactLike {
  origen: "siac" | "manual";
  campoSiac: string | null;
  valor: string;
  nombre: string | null;
  notas: string | null;
  tipoContacto: TipoContacto;
  motivoNoRecibe: string | null;
  updatedBy: string | null;
  updatedAt: string;
}

export interface ClientProfile {
  id: string;
  nombre: string;
  numeroCliente: string;
  domicilioParticular: string | null;
  domicilioTrabajo: string | null;
  pausaHasta: string | null;
  pausaMotivo: string | null;
  contactoCobranza: { id: string | null; por: string | null; at: string | null };
  /** Cuenta a la que paga. null = sin cuenta: no recibe recordatorios. */
  cuentaPago: { id: string; alias: string; banco: string; beneficiario: string; clabe: string; por: string | null; at: string | null } | null;
  recipient: Recipient;
  creditos: {
    id: string;
    noCredito: string;
    tipoCredito: string | null;
    montoCredito: number | null;
    enListado: boolean;
    etapaManual: string | null;
    fechaCorte: string | null;
    antiguedad: number | null;
    totalVencido: number | null;
    totalAdeudo: number | null;
    interesesMoratorios: number | null;
    proximoVencimiento: string | null;
    fechaUltimoPago: string | null;
    /** Última consulta de "saldo al día" a SIAC, si la hay. */
    saldoAlDia: { fechaCorte: string; saldoVencido: number; totalPagar: number; consultadoAt: string; pedidoPor: string } | null;
  }[];
  contactos: ProfileContact[];
  pagos: { id: string; noCredito: string; fecha: string; monto: number; concepto: string | null }[];
  alertas: { id: number; tipo: string; severidad: string; createdAt: string }[];
  promesas: {
    id: number;
    monto: number;
    fechaCompromiso: string;
    estado: string;
    createdBy: string;
    noCredito: string | null;
    canal: string | null;
    notas: string | null;
  }[];
  timeline: { id: string; tipo: string; descripcion: string | null; actor: string; ocurridoAt: string }[];
}

const iso = (d: unknown) => (d instanceof Date ? d.toISOString() : (d as string));

function mapContact(r: Record<string, unknown>): Omit<ProfileContact, "motivoNoRecibe" | "tipoContacto"> {
  return {
    id: r.id as string,
    relacion: r.relacion as ContactLike["relacion"],
    rol: (r.rol as ContactLike["rol"]) ?? null,
    tipo: r.tipo as ContactLike["tipo"],
    telefonoWhatsapp: (r.telefono_whatsapp as string) ?? null,
    estatus: r.estatus as ContactLike["estatus"],
    bajaWhatsappAt: r.baja_whatsapp_at ? iso(r.baja_whatsapp_at) : null,
    esPrincipal: Boolean(r.es_principal),
    origen: r.origen as "siac" | "manual",
    campoSiac: (r.campo_siac as string) ?? null,
    valor: r.valor_original as string,
    nombre: (r.nombre_contacto as string) ?? null,
    notas: (r.notas as string) ?? null,
    updatedBy: (r.updated_by as string) ?? (r.created_by as string) ?? null,
    updatedAt: iso(r.updated_at),
  };
}

export async function getClientProfile(clientId: string): Promise<ClientProfile | null> {
  const ambiente = ambienteActual();
  const [c] = await sql`
    SELECT id, nombre, numero_cliente, domicilio_particular, domicilio_trabajo,
           to_char(pausa_hasta, 'YYYY-MM-DD') AS pausa_hasta, pausa_motivo,
           contacto_cobranza_id, contacto_cobranza_por, contacto_cobranza_at,
           cuenta_pago_id, cuenta_pago_por, cuenta_pago_at,
           (SELECT row_to_json(a) FROM (SELECT alias, banco, beneficiario, clabe FROM col_payment_accounts WHERE id = cuenta_pago_id) a) AS cuenta
    FROM col_clients WHERE id = ${clientId} AND ambiente = ${ambiente}
  `;
  if (!c) return null;

  const [creditos, contactos, pagos, alertas, promesas, timeline, saldos] = await Promise.all([
    sql`
      SELECT cr.id, cr.no_credito, cr.tipo_credito, cr.monto_credito, cr.en_listado, cr.etapa_manual,
             to_char(s.fecha_corte, 'YYYY-MM-DD') AS fecha_corte, s.antiguedad, s.total_vencido, s.total_adeudo,
             s.intereses_moratorios, to_char(s.proximo_vencimiento, 'YYYY-MM-DD') AS proximo_vencimiento,
             to_char(s.fecha_ultimo_pago, 'YYYY-MM-DD') AS fecha_ultimo_pago
      FROM col_credits cr
      LEFT JOIN LATERAL (
        SELECT * FROM col_credit_snapshots WHERE credit_id = cr.id ORDER BY fecha_corte DESC LIMIT 1
      ) s ON true
      WHERE cr.client_id = ${clientId}
      ORDER BY cr.en_listado DESC, s.total_vencido DESC NULLS LAST, cr.no_credito
    `,
    sql`
      SELECT * FROM col_contacts WHERE client_id = ${clientId}
      ORDER BY (relacion = 'titular') DESC, (tipo = 'telefono') DESC, origen DESC, created_at
    `,
    sql`
      SELECT p.id, cr.no_credito, to_char(p.fecha_aplicacion, 'YYYY-MM-DD') AS fecha, p.monto, p.concepto
      FROM col_payments p JOIN col_credits cr ON cr.id = p.credit_id
      WHERE cr.client_id = ${clientId}
      ORDER BY p.fecha_aplicacion DESC, p.id DESC LIMIT 24
    `,
    sql`SELECT id, tipo, severidad, created_at FROM col_alerts WHERE client_id = ${clientId} AND estado = 'abierta' ORDER BY created_at DESC`,
    sql`
      SELECT p.id, p.monto, to_char(p.fecha_compromiso, 'YYYY-MM-DD') AS fecha_compromiso, p.estado, p.created_by,
             p.canal, p.notas, cr.no_credito
      FROM col_promises p LEFT JOIN col_credits cr ON cr.id = p.credit_id
      WHERE p.client_id = ${clientId} ORDER BY (p.estado = 'vigente') DESC, p.created_at DESC LIMIT 10
    `,
    sql`
      SELECT id, tipo, descripcion, actor, ocurrido_at FROM col_activities
      WHERE client_id = ${clientId} ORDER BY ocurrido_at DESC, id DESC LIMIT 60
    `,
    sql`
      SELECT DISTINCT ON (q.credit_id) q.credit_id, to_char(q.fecha_corte, 'YYYY-MM-DD') AS fecha_corte,
             q.saldo_vencido, q.total_pagar, q.created_at, q.pedido_por
      FROM col_saldo_consultas q JOIN col_credits cr ON cr.id = q.credit_id
      WHERE cr.client_id = ${clientId}
      ORDER BY q.credit_id, q.created_at DESC
    `,
  ]);
  const saldoPorCredito = new Map(saldos.map((s) => [s.credit_id as string, s]));

  const cs: ProfileContact[] = contactos.map((r) => {
    const base = mapContact(r);
    return { ...base, tipoContacto: tipoDe(base), motivoNoRecibe: motivoNoRecibe(base) };
  });
  const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));

  return {
    id: c.id,
    nombre: c.nombre,
    numeroCliente: c.numero_cliente,
    domicilioParticular: c.domicilio_particular,
    domicilioTrabajo: c.domicilio_trabajo,
    pausaHasta: c.pausa_hasta,
    pausaMotivo: c.pausa_motivo,
    contactoCobranza: {
      id: c.contacto_cobranza_id,
      por: c.contacto_cobranza_por,
      at: c.contacto_cobranza_at ? iso(c.contacto_cobranza_at) : null,
    },
    cuentaPago:
      c.cuenta_pago_id && c.cuenta
        ? { id: c.cuenta_pago_id, ...c.cuenta, por: c.cuenta_pago_por, at: c.cuenta_pago_at ? iso(c.cuenta_pago_at) : null }
        : null,
    recipient: chooseRecipient(cs, c.contacto_cobranza_id),
    creditos: creditos.map((r) => ({
      id: r.id,
      noCredito: r.no_credito,
      tipoCredito: r.tipo_credito,
      montoCredito: num(r.monto_credito),
      enListado: r.en_listado,
      etapaManual: r.etapa_manual,
      fechaCorte: r.fecha_corte,
      antiguedad: num(r.antiguedad),
      totalVencido: num(r.total_vencido),
      totalAdeudo: num(r.total_adeudo),
      interesesMoratorios: num(r.intereses_moratorios),
      proximoVencimiento: r.proximo_vencimiento,
      fechaUltimoPago: r.fecha_ultimo_pago,
      saldoAlDia: (() => {
        const s = saldoPorCredito.get(r.id);
        return s
          ? { fechaCorte: s.fecha_corte, saldoVencido: Number(s.saldo_vencido), totalPagar: Number(s.total_pagar), consultadoAt: iso(s.created_at), pedidoPor: s.pedido_por }
          : null;
      })(),
    })),
    contactos: cs,
    pagos: pagos.map((p) => ({ id: String(p.id), noCredito: p.no_credito, fecha: p.fecha, monto: Number(p.monto), concepto: p.concepto })),
    alertas: alertas.map((a) => ({ id: a.id, tipo: a.tipo, severidad: a.severidad, createdAt: iso(a.created_at) })),
    promesas: promesas.map((p) => ({
      id: p.id,
      monto: Number(p.monto),
      fechaCompromiso: p.fecha_compromiso,
      estado: p.estado,
      createdBy: p.created_by,
      noCredito: p.no_credito,
      canal: p.canal,
      notas: p.notas,
    })),
    timeline: timeline.map((t) => ({ id: String(t.id), tipo: t.tipo, descripcion: t.descripcion, actor: t.actor, ocurridoAt: iso(t.ocurrido_at) })),
  };
}

// ---------------------------------------------------------------- cambios a contactos

export class ContactError extends Error {}

const describir = (k: Record<string, unknown>) =>
  k.nombre_contacto ? `${k.nombre_contacto} (${k.valor_original})` : k.valor_original;

/** Carga un contacto y verifica que sea de un cliente del ambiente actual. */
async function loadContact(tx: Tx, contactId: string) {
  const [k] = await tx`
    SELECT k.*, c.contacto_cobranza_id
    FROM col_contacts k JOIN col_clients c ON c.id = k.client_id
    WHERE k.id = ${contactId} AND c.ambiente = ${ambienteActual()}
    FOR UPDATE OF k
  `;
  if (!k) throw new ContactError("No encontramos ese contacto");
  return k;
}

async function activity(tx: Tx, clientId: string, descripcion: string, actor: string, metadata: Record<string, unknown>) {
  await tx`
    INSERT INTO col_activities (client_id, tipo, descripcion, metadata, actor)
    VALUES (${clientId}, 'cambio_contacto', ${descripcion}, ${JSON.stringify(metadata)}::jsonb, ${actor})
  `;
}

/** Si el cliente ya tiene a quién mandarle el recordatorio, cierra su alerta de teléfono inválido. */
async function closePhoneAlertIfFixed(tx: Tx, clientId: string, actor: string) {
  await tx`
    UPDATE col_alerts a SET estado = 'atendida', atendida_por = ${actor}, atendida_at = now()
    FROM col_clients c
    WHERE a.client_id = c.id AND c.id = ${clientId} AND a.tipo = 'telefono_invalido' AND a.estado = 'abierta'
      AND EXISTS (
        SELECT 1 FROM col_contacts k
        WHERE k.client_id = c.id AND (k.id = c.contacto_cobranza_id OR k.es_principal)
          AND k.relacion = 'titular' AND k.tipo = 'telefono' AND k.telefono_whatsapp IS NOT NULL
          AND k.estatus = 'activo' AND k.baja_whatsapp_at IS NULL
      )
  `;
}

/**
 * Elige el contacto que recibe los recordatorios de cobranza del cliente.
 * `contactId = null` regresa al sugerido por SIAC.
 */
export async function setContactoCobranza(p: { clientId: string; contactId: string | null; actor: string }) {
  await sql.begin(async (tx) => {
    const [c] = await tx`
      SELECT id, contacto_cobranza_id FROM col_clients WHERE id = ${p.clientId} AND ambiente = ${ambienteActual()} FOR UPDATE
    `;
    if (!c) throw new ContactError("No encontramos ese cliente");

    let descripcion = "Los recordatorios vuelven al contacto sugerido por SIAC";
    if (p.contactId) {
      const k = await loadContact(tx, p.contactId);
      if (k.client_id !== p.clientId) throw new ContactError("Ese contacto no es de este cliente");
      const motivo = motivoNoRecibe(mapContact(k));
      if (motivo) throw new ContactError(`No se puede usar para recordatorios: ${motivo.toLowerCase()}`);
      descripcion = `Los recordatorios de cobranza ahora van a ${describir(k)}`;
    }
    await tx`
      UPDATE col_clients SET contacto_cobranza_id = ${p.contactId}, contacto_cobranza_por = ${p.actor}, contacto_cobranza_at = now()
      WHERE id = ${p.clientId}
    `;
    await activity(tx, p.clientId, descripcion, p.actor, { contactoAnterior: c.contacto_cobranza_id, contactoNuevo: p.contactId });
    await closePhoneAlertIfFixed(tx, p.clientId, p.actor);
  });
  await logAudit({ actorEmail: p.actor, action: "cobranza_contacto_recordatorios", entityType: "col_client", entityId: p.clientId, metadata: { contactId: p.contactId } });
}

/** Cambia el tipo de contacto. Si deja de ser del deudor y recibía los recordatorios, deja de recibirlos. */
export async function setContactTipo(p: { contactId: string; tipo: TipoContacto; actor: string }) {
  const tipo = TIPOS_CONTACTO[p.tipo];
  if (!tipo) throw new ContactError("Tipo de contacto no válido");
  let clientId = "";
  await sql.begin(async (tx) => {
    const k = await loadContact(tx, p.contactId);
    clientId = k.client_id;
    const antes = TIPOS_CONTACTO[tipoDe(mapContact(k))].label;
    await tx`
      UPDATE col_contacts SET relacion = ${tipo.relacion}, rol = ${tipo.rol}, updated_by = ${p.actor}, updated_at = now()
      WHERE id = ${p.contactId}
    `;
    let extra = "";
    if (!tipo.deudor && k.contacto_cobranza_id === p.contactId) {
      await tx`UPDATE col_clients SET contacto_cobranza_id = NULL, contacto_cobranza_por = ${p.actor}, contacto_cobranza_at = now() WHERE id = ${clientId}`;
      extra = "; dejó de recibir los recordatorios porque ya no es del deudor";
    }
    await activity(tx, clientId, `${describir(k)}: de "${antes}" a "${tipo.label}"${extra}`, p.actor, { contactId: p.contactId, tipo: p.tipo });
  });
  await logAudit({ actorEmail: p.actor, action: "cobranza_contacto_tipo", entityType: "col_contact", entityId: p.contactId, metadata: { tipo: p.tipo, clientId } });
}

const ESTATUS_LABEL = { activo: "activo", invalido: "inválido", baja: "dado de baja de WhatsApp" } as const;

/** Marca un contacto como activo, inválido o dado de baja (el cliente pidió no recibir mensajes). */
export async function setContactEstatus(p: { contactId: string; estatus: "activo" | "invalido" | "baja"; actor: string }) {
  if (!(p.estatus in ESTATUS_LABEL)) throw new ContactError("Estado no válido");
  let clientId = "";
  await sql.begin(async (tx) => {
    const k = await loadContact(tx, p.contactId);
    clientId = k.client_id;
    await tx`
      UPDATE col_contacts SET
        estatus = ${p.estatus},
        baja_whatsapp_at = ${p.estatus === "baja" ? sql`now()` : p.estatus === "activo" ? null : sql`baja_whatsapp_at`},
        updated_by = ${p.actor}, updated_at = now()
      WHERE id = ${p.contactId}
    `;
    await activity(tx, clientId, `${describir(k)} marcado como ${ESTATUS_LABEL[p.estatus]}`, p.actor, { contactId: p.contactId, estatus: p.estatus });
    await closePhoneAlertIfFixed(tx, clientId, p.actor);
  });
  await logAudit({ actorEmail: p.actor, action: "cobranza_contacto_estatus", entityType: "col_contact", entityId: p.contactId, metadata: { estatus: p.estatus, clientId } });
}

/** Agrega un contacto que no está en SIAC. Opcionalmente lo vuelve el que recibe los recordatorios. */
export async function addManualContact(p: {
  clientId: string;
  tipo: "telefono" | "email";
  valor: string;
  nombre: string | null;
  tipoContacto: TipoContacto;
  notas: string | null;
  usarParaRecordatorios: boolean;
  actor: string;
}) {
  const v = validarContactoNuevo(p.tipo, p.valor);
  if (!v.ok) throw new ContactError(v.error);
  const tipo = TIPOS_CONTACTO[p.tipoContacto];
  if (!tipo) throw new ContactError("Tipo de contacto no válido");
  if (p.usarParaRecordatorios && (!tipo.deudor || p.tipo !== "telefono")) {
    throw new ContactError("Solo un teléfono de alguien del deudor puede recibir los recordatorios");
  }

  let contactId = "";
  await sql.begin(async (tx) => {
    const [c] = await tx`SELECT id FROM col_clients WHERE id = ${p.clientId} AND ambiente = ${ambienteActual()} FOR UPDATE`;
    if (!c) throw new ContactError("No encontramos ese cliente");
    const [dup] = await tx`
      SELECT id FROM col_contacts WHERE client_id = ${p.clientId}
        AND (lower(valor_original) = lower(${v.valor}) OR (${v.telefonoWhatsapp}::text IS NOT NULL AND telefono_whatsapp = ${v.telefonoWhatsapp}))
      LIMIT 1
    `;
    if (dup) throw new ContactError("Ese contacto ya está registrado para este cliente");

    const [row] = await tx`
      INSERT INTO col_contacts (client_id, origen, relacion, rol, tipo, valor_original, telefono_whatsapp, nombre_contacto, notas, created_by, updated_by)
      VALUES (${p.clientId}, 'manual', ${tipo.relacion}, ${tipo.rol}, ${p.tipo}, ${v.valor}, ${v.telefonoWhatsapp},
              ${p.nombre?.trim() || null}, ${p.notas?.trim() || null}, ${p.actor}, ${p.actor})
      RETURNING id
    `;
    contactId = row.id;
    const quien = p.nombre?.trim() ? `${p.nombre.trim()} (${v.valor})` : v.valor;
    await activity(tx, p.clientId, `Se agregó el contacto ${quien} como "${tipo.label}"`, p.actor, { contactId, tipo: p.tipoContacto });
    if (p.usarParaRecordatorios) {
      await tx`
        UPDATE col_clients SET contacto_cobranza_id = ${contactId}, contacto_cobranza_por = ${p.actor}, contacto_cobranza_at = now()
        WHERE id = ${p.clientId}
      `;
      await activity(tx, p.clientId, `Los recordatorios de cobranza ahora van a ${quien}`, p.actor, { contactoNuevo: contactId });
      await closePhoneAlertIfFixed(tx, p.clientId, p.actor);
    }
  });
  await logAudit({ actorEmail: p.actor, action: "cobranza_contacto_alta", entityType: "col_contact", entityId: contactId, metadata: { clientId: p.clientId, tipo: p.tipoContacto, usarParaRecordatorios: p.usarParaRecordatorios } });
  return contactId;
}
