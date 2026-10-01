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

/**
 * A quién se le manda el recordatorio de cobranza: el contacto que eligió el
 * equipo si todavía puede recibirlo; si no, el sugerido por SIAC; si ninguno
 * sirve, a nadie.
 */
export function chooseRecipient(contactos: ContactLike[], elegidoPorEquipo: string | null): Recipient {
  let aviso: string | null = null;
  if (elegidoPorEquipo) {
    const elegido = contactos.find((c) => c.id === elegidoPorEquipo);
    if (elegido) {
      const motivo = motivoNoRecibe(elegido);
      if (!motivo) return { contactId: elegido.id, origen: "equipo", aviso: null };
      aviso = `El contacto elegido ya no sirve (${motivo.toLowerCase()}); se usa el sugerido por SIAC`;
    } else {
      aviso = "El contacto elegido ya no existe; se usa el sugerido por SIAC";
    }
  }
  const sugerido = contactos.find((c) => c.esPrincipal && !motivoNoRecibe(c));
  if (sugerido) return { contactId: sugerido.id, origen: "siac", aviso };
  return { contactId: null, origen: null, aviso: aviso ?? "Ningún contacto del deudor tiene un WhatsApp válido" };
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
