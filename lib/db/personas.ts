// Personas de contacto y actividad comercial de una empresa (crm_personas,
// crm_actividades). Los teléfonos y correos siguen en col_contacts: aquí solo
// se agrupan por persona (col_contacts.persona_id). Nada de esto cambia a quién
// le llegan los recordatorios de cobranza.

import { sql, transaccion } from "@/lib/db";
import { logAudit } from "@/lib/db/audit";
import { ambienteActual } from "@/lib/db/collections";
import { addManualContact, ContactError } from "@/lib/db/collection-clients";
import { chooseRecipient } from "@/lib/collections/contacts";
import { ETIQUETAS_ACTIVIDAD } from "@/lib/collections/gestiones";
import { unirHistorial, type DatosActividad, type DatosPersona, type OrigenHistorial } from "@/lib/clientes/personas";

export class PersonaError extends Error {}

export interface Persona extends DatosPersona {
  id: string;
  updatedBy: string | null;
  updatedAt: string;
}

export interface Canal {
  id: string;
  clientId: string;
  relacion: "titular" | "aval" | "referencia";
  tipo: "telefono" | "email";
  valor: string;
  nombre: string | null;
  origen: "siac" | "manual";
  estatus: "activo" | "invalido" | "baja";
  personaId: string | null;
  /** Le llegan los recordatorios de cobranza (misma regla que el expediente). */
  recibeRecordatorios: boolean;
}

/** La empresa existe en el ambiente actual; si no, PersonaError. */
async function empresaDelAmbiente(empresaId: string) {
  const [e] = await sql`SELECT id FROM crm_empresas WHERE id = ${empresaId} AND ambiente = ${ambienteActual()}`;
  if (!e) throw new PersonaError("Esa empresa no existe.");
}

export async function getContactos(empresaId: string): Promise<{ personas: Persona[]; canales: Canal[]; clientes: string[] }> {
  const [personas, clientes, canales] = await Promise.all([
    sql`
      SELECT * FROM crm_personas WHERE empresa_id = ${empresaId}
      ORDER BY vigente DESC, es_principal DESC, nombre
    `,
    sql`SELECT id, contacto_cobranza_id FROM col_clients WHERE empresa_id = ${empresaId}`,
    sql`
      SELECT k.* FROM col_contacts k JOIN col_clients c ON c.id = k.client_id
      WHERE c.empresa_id = ${empresaId}
      ORDER BY k.relacion, k.tipo, k.created_at
    `,
  ]);

  const destinatarios = new Set<string>();
  for (const c of clientes) {
    const suyos = canales
      .filter((k) => k.client_id === c.id)
      .map((k) => ({
        id: k.id as string,
        relacion: k.relacion,
        rol: k.rol,
        tipo: k.tipo,
        telefonoWhatsapp: k.telefono_whatsapp,
        estatus: k.estatus,
        bajaWhatsappAt: k.baja_whatsapp_at ? String(k.baja_whatsapp_at) : null,
        esPrincipal: k.es_principal,
      }));
    const r = chooseRecipient(suyos, c.contacto_cobranza_id);
    if (r.contactId) destinatarios.add(r.contactId);
  }

  return {
    personas: personas.map((p) => ({
      id: p.id,
      nombre: p.nombre,
      puesto: p.puesto,
      rolDecision: p.rol_decision,
      esRepresentanteLegal: p.es_representante_legal,
      canalPreferido: p.canal_preferido,
      horarioPreferido: p.horario_preferido,
      esPrincipal: p.es_principal,
      vigente: p.vigente,
      notas: p.notas,
      updatedBy: p.updated_by,
      updatedAt: (p.updated_at as Date).toISOString(),
    })),
    canales: canales.map((k) => ({
      id: k.id,
      clientId: k.client_id,
      relacion: k.relacion,
      tipo: k.tipo,
      valor: k.valor_original,
      nombre: k.nombre_contacto,
      origen: k.origen,
      estatus: k.estatus,
      personaId: k.persona_id,
      recibeRecordatorios: destinatarios.has(k.id),
    })),
    clientes: clientes.map((c) => c.id as string),
  };
}

/** Alta (sin personaId) o edición de una persona. Si queda como principal, las demás de la empresa dejan de serlo. */
export async function guardarPersona(p: { empresaId: string; personaId?: string; datos: DatosPersona; actor: string }): Promise<string> {
  await empresaDelAmbiente(p.empresaId);
  const d = p.datos;
  const id = await transaccion(async (tx) => {
    if (p.personaId) {
      const [antes] = await tx`SELECT id FROM crm_personas WHERE id = ${p.personaId} AND empresa_id = ${p.empresaId} FOR UPDATE`;
      if (!antes) throw new PersonaError("Esa persona no es de esta empresa.");
    }
    if (d.esPrincipal) {
      await tx`UPDATE crm_personas SET es_principal = false, updated_by = ${p.actor}, updated_at = now() WHERE empresa_id = ${p.empresaId} AND es_principal AND id IS DISTINCT FROM ${p.personaId ?? null}::uuid`;
    }
    if (p.personaId) {
      await tx`
        UPDATE crm_personas SET
          nombre = ${d.nombre}, puesto = ${d.puesto}, rol_decision = ${d.rolDecision}, es_representante_legal = ${d.esRepresentanteLegal},
          canal_preferido = ${d.canalPreferido}, horario_preferido = ${d.horarioPreferido}, es_principal = ${d.esPrincipal},
          vigente = ${d.vigente}, notas = ${d.notas}, updated_by = ${p.actor}, updated_at = now()
        WHERE id = ${p.personaId}
      `;
      return p.personaId;
    }
    const [row] = await tx`
      INSERT INTO crm_personas (empresa_id, nombre, puesto, rol_decision, es_representante_legal, canal_preferido, horario_preferido, es_principal, vigente, notas, created_by, updated_by)
      VALUES (${p.empresaId}, ${d.nombre}, ${d.puesto}, ${d.rolDecision}, ${d.esRepresentanteLegal}, ${d.canalPreferido}, ${d.horarioPreferido}, ${d.esPrincipal}, ${d.vigente}, ${d.notas}, ${p.actor}, ${p.actor})
      RETURNING id
    `;
    return row.id as string;
  });
  await logAudit({ actorEmail: p.actor, action: p.personaId ? "editar_persona" : "alta_persona", entityType: "persona", entityId: id, metadata: { empresaId: p.empresaId, principal: d.esPrincipal, vigente: d.vigente } });
  return id;
}

/** Liga (o desliga, con personaId null) un teléfono o correo del deudor a una persona de la misma empresa. */
export async function asignarCanal(p: { empresaId: string; contactId: string; personaId: string | null; actor: string }) {
  await empresaDelAmbiente(p.empresaId);
  const [k] = await sql`
    SELECT k.id, k.relacion FROM col_contacts k JOIN col_clients c ON c.id = k.client_id
    WHERE k.id = ${p.contactId} AND c.empresa_id = ${p.empresaId}
  `;
  if (!k) throw new PersonaError("Ese teléfono o correo no es de esta empresa.");
  if (k.relacion !== "titular") throw new PersonaError("Los avales y las referencias no se asignan a personas de la empresa.");
  if (p.personaId) {
    const [per] = await sql`SELECT id FROM crm_personas WHERE id = ${p.personaId} AND empresa_id = ${p.empresaId}`;
    if (!per) throw new PersonaError("Esa persona no es de esta empresa.");
  }
  await sql`UPDATE col_contacts SET persona_id = ${p.personaId} WHERE id = ${p.contactId}`;
  await logAudit({ actorEmail: p.actor, action: "asignar_canal_persona", entityType: "col_contact", entityId: p.contactId, metadata: { empresaId: p.empresaId, personaId: p.personaId } });
}

/**
 * Agrega un teléfono o correo a una persona. Queda en el expediente de cobranza
 * del primer cliente de SIAC de la empresa como contacto del deudor «sin
 * clasificar», pero NO como destinatario de los recordatorios.
 */
export async function agregarCanal(p: { empresaId: string; personaId: string; tipo: "telefono" | "email"; valor: string; actor: string }) {
  await empresaDelAmbiente(p.empresaId);
  const [per] = await sql`SELECT nombre FROM crm_personas WHERE id = ${p.personaId} AND empresa_id = ${p.empresaId}`;
  if (!per) throw new PersonaError("Esa persona no es de esta empresa.");
  const [cliente] = await sql`SELECT id FROM col_clients WHERE empresa_id = ${p.empresaId} ORDER BY numero_cliente LIMIT 1`;
  if (!cliente) throw new PersonaError("Esta empresa todavía no tiene cliente en SIAC; por ahora los teléfonos se guardan en el expediente de cobranza.");
  try {
    await addManualContact({
      clientId: cliente.id,
      tipo: p.tipo,
      valor: p.valor,
      nombre: per.nombre,
      tipoContacto: "deudor",
      notas: null,
      usarParaRecordatorios: false,
      actor: p.actor,
      personaId: p.personaId,
    });
  } catch (e) {
    if (e instanceof ContactError) throw new PersonaError(e.message);
    throw e;
  }
}

export async function registrarActividad(p: { empresaId: string; datos: DatosActividad; actor: string }) {
  await empresaDelAmbiente(p.empresaId);
  if (p.datos.personaId) {
    const [per] = await sql`SELECT id FROM crm_personas WHERE id = ${p.datos.personaId} AND empresa_id = ${p.empresaId}`;
    if (!per) throw new PersonaError("Esa persona no es de esta empresa.");
  }
  await sql`
    INSERT INTO crm_actividades (empresa_id, persona_id, tipo, resultado, descripcion, actor, ocurrido_at)
    VALUES (${p.empresaId}, ${p.datos.personaId}, ${p.datos.tipo}, ${p.datos.resultado}, ${p.datos.descripcion}, ${p.actor}, ${p.datos.ocurridoAt})
  `;
}

/** Historial unificado de la empresa: actividad comercial y expediente de cobranza (los 300 más recientes de cada uno). */
export async function getHistorial(empresaId: string, filtro: "todo" | OrigenHistorial = "todo") {
  const [comercial, cobranza] = await Promise.all([
    sql`
      SELECT a.id, a.tipo, a.resultado, a.descripcion, a.actor, a.ocurrido_at, p.nombre AS persona
      FROM crm_actividades a LEFT JOIN crm_personas p ON p.id = a.persona_id
      WHERE a.empresa_id = ${empresaId}
      ORDER BY a.ocurrido_at DESC LIMIT 300
    `,
    sql`
      SELECT a.id, a.tipo, a.descripcion, a.actor, a.ocurrido_at
      FROM col_activities a JOIN col_clients c ON c.id = a.client_id
      WHERE c.empresa_id = ${empresaId}
      ORDER BY a.ocurrido_at DESC LIMIT 300
    `,
  ]);
  return unirHistorial(
    comercial.map((a) => ({
      id: String(a.id),
      tipo: a.tipo,
      resultado: a.resultado,
      descripcion: a.descripcion,
      actor: a.actor,
      persona: a.persona,
      ocurridoAt: (a.ocurrido_at as Date).toISOString(),
    })),
    cobranza.map((a) => ({
      id: String(a.id),
      tipo: a.tipo,
      etiqueta: ETIQUETAS_ACTIVIDAD[a.tipo] ?? a.tipo,
      descripcion: a.descripcion,
      actor: a.actor,
      ocurridoAt: (a.ocurrido_at as Date).toISOString(),
    })),
    filtro,
  );
}
