// Tipos de contacto y a quién se le mandan los recordatorios de cobranza.
// Funciones puras, sin base de datos, para poder probarlas con `node --test`.

import { normalizePhoneMx } from "./rules.ts";

/**
 * Tipos que el equipo puede asignar. Los "del deudor" son personas de la
 * empresa que debe (en col_contacts: relacion = 'titular' más un rol); son
 * los únicos que pueden recibir recordatorios automáticos. Aval y referencias
 * son terceros: se pueden ver y llamar a mano, pero no reciben recordatorios
 * mientras el área legal no valide otra cosa.
 */
export const TIPOS_CONTACTO = {
  dueno: { label: "Dueño o representante legal", relacion: "titular", rol: "dueno", deudor: true },
  pagos: { label: "Pagos o tesorería", relacion: "titular", rol: "pagos", deudor: true },
  contabilidad: { label: "Contabilidad", relacion: "titular", rol: "contabilidad", deudor: true },
  otro: { label: "Otro de la empresa", relacion: "titular", rol: "otro", deudor: true },
  deudor: { label: "Del deudor (sin clasificar)", relacion: "titular", rol: null, deudor: true },
  aval: { label: "Aval", relacion: "aval", rol: null, deudor: false },
  referencia: { label: "Referencia", relacion: "referencia", rol: null, deudor: false },
} as const;

export type TipoContacto = keyof typeof TIPOS_CONTACTO;

export interface ContactLike {
  id: string;
  relacion: "titular" | "aval" | "referencia";
  rol: "dueno" | "pagos" | "contabilidad" | "otro" | null;
  tipo: "telefono" | "email";
  telefonoWhatsapp: string | null;
  estatus: "activo" | "invalido" | "baja";
  bajaWhatsappAt: string | null;
  esPrincipal: boolean;
  /**
   * El equipo lo marcó para recibir los recordatorios (col_contacts.recibe_recordatorios).
   * undefined: la base todavía no tiene la columna; se usa el elegido de antes
   * (col_clients.contacto_cobranza_id).
   */
  recibeRecordatorios?: boolean;
}

export function tipoDe(c: Pick<ContactLike, "relacion" | "rol">): TipoContacto {
  if (c.relacion === "aval") return "aval";
  if (c.relacion === "referencia") return "referencia";
  return c.rol ?? "deudor";
}

/** Por qué un contacto no puede recibir recordatorios, o null si sí puede. */
export function motivoNoRecibe(c: ContactLike): string | null {
  if (c.relacion !== "titular") return "Es un tercero (aval o referencia): no recibe recordatorios automáticos";
  if (c.tipo !== "telefono") return "Es un correo; los recordatorios van por WhatsApp";
  if (!c.telefonoWhatsapp) return "El teléfono no tiene 10 dígitos válidos";
  if (c.estatus === "invalido") return "Está marcado como inválido";
  if (c.estatus === "baja" || c.bajaWhatsappAt) return "Pidió no recibir mensajes";
  return null;
}

export interface Recipient {
  contactId: string | null;
  /** equipo: lo eligió una persona. siac: el sugerido por la sincronización. */
  origen: "equipo" | "siac" | null;
  /** Explica por qué no se usa el elegido por el equipo, si aplica. */
  aviso: string | null;
}

export interface Recipients {
  /** A quiénes se les manda, sin números repetidos. Vacío: a nadie. */
  contactIds: string[];
  origen: "equipo" | "siac" | null;
  aviso: string | null;
}

/** Marcados por el equipo; si la base aún no tiene la marca, el elegido de antes. */
function marcados(contactos: ContactLike[], elegidoPorEquipo: string | null): { marcados: ContactLike[]; faltaElegido: boolean } {
  if (contactos.some((c) => c.recibeRecordatorios !== undefined)) return { marcados: contactos.filter((c) => c.recibeRecordatorios), faltaElegido: false };
  if (!elegidoPorEquipo) return { marcados: [], faltaElegido: false };
  const elegido = contactos.find((c) => c.id === elegidoPorEquipo);
  return { marcados: elegido ? [elegido] : [], faltaElegido: !elegido };
}

/**
 * A quiénes se les manda el recordatorio de cobranza por WhatsApp: los
 * contactos del deudor que marcó el equipo y todavía pueden recibirlo (cada
 * número una vez); si ninguno sirve, el sugerido por SIAC; si tampoco, a nadie.
 */
export function chooseRecipients(contactos: ContactLike[], elegidoPorEquipo: string | null = null): Recipients {
  const m = marcados(contactos, elegidoPorEquipo);
  const vistos = new Set<string>();
  const validos: string[] = [];
  const noSirven: string[] = [];
  for (const c of m.marcados) {
    const motivo = motivoNoRecibe(c);
    if (motivo) {
      noSirven.push(motivo.toLowerCase());
      continue;
    }
    if (vistos.has(c.telefonoWhatsapp!)) continue;
    vistos.add(c.telefonoWhatsapp!);
    validos.push(c.id);
  }
  const avisoParcial =
    noSirven.length === 0 ? null
    : noSirven.length === 1 ? `Un contacto marcado no recibe (${noSirven[0]})`
    : `${noSirven.length} contactos marcados no reciben (${[...new Set(noSirven)].join("; ")})`;
  if (validos.length) return { contactIds: validos, origen: "equipo", aviso: avisoParcial };

  let aviso: string | null = null;
  if (m.faltaElegido) aviso = "El contacto elegido ya no existe; se usa el sugerido por SIAC";
  else if (m.marcados.length === 1) aviso = `El contacto elegido ya no sirve (${noSirven[0]}); se usa el sugerido por SIAC`;
  else if (m.marcados.length > 1) aviso = "Ninguno de los contactos marcados sirve; se usa el sugerido por SIAC";
  const sugerido = contactos.find((c) => c.esPrincipal && !motivoNoRecibe(c));
  if (sugerido) return { contactIds: [sugerido.id], origen: "siac", aviso };
  return { contactIds: [], origen: null, aviso: aviso ?? "Ningún contacto del deudor tiene un WhatsApp válido" };
}

/** El primero de chooseRecipients (para lo que muestra un solo destinatario). */
export function chooseRecipient(contactos: ContactLike[], elegidoPorEquipo: string | null): Recipient {
  const r = chooseRecipients(contactos, elegidoPorEquipo);
  return { contactId: r.contactIds[0] ?? null, origen: r.origen, aviso: r.aviso };
}

/** Valida y normaliza un contacto que agrega el equipo a mano. */
export function validarContactoNuevo(
  tipo: "telefono" | "email",
  valor: string,
): { ok: true; valor: string; telefonoWhatsapp: string | null } | { ok: false; error: string } {
  const v = valor.trim();
  if (!v) return { ok: false, error: "Escribe el teléfono o el correo" };
  if (tipo === "email") {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? { ok: true, valor: v.toLowerCase(), telefonoWhatsapp: null } : { ok: false, error: "El correo no tiene un formato válido" };
  }
  const whatsapp = normalizePhoneMx(v);
  if (!whatsapp) return { ok: false, error: "El teléfono debe tener 10 dígitos (puede llevar +52 al inicio)" };
  return { ok: true, valor: v, telefonoWhatsapp: whatsapp };
}

/**
 * Para los envíos por WhatsApp: una copia del candidato por cada destinatario
 * (chooseRecipients), cada una con solo ese contacto, para decidir y no
 * repetir el recordatorio número por número. Sin destinatarios, el candidato
 * tal cual (la decisión dirá que no hay WhatsApp válido).
 */
export function porDestinatario<T extends { contactos: ContactLike[]; contactoCobranzaId: string | null }>(c: T): { contactId: string | null; candidato: T }[] {
  const { contactIds } = chooseRecipients(c.contactos, c.contactoCobranzaId);
  if (!contactIds.length) return [{ contactId: null, candidato: c }];
  return contactIds.map((id) => ({
    contactId: id,
    candidato: { ...c, contactos: c.contactos.filter((k) => k.id === id).map((k) => ({ ...k, recibeRecordatorios: true })), contactoCobranzaId: id },
  }));
}
