// Recordatorios de mora por WhatsApp: a quién se le manda hoy, con qué
// plantilla y qué valores. Funciones puras, sin base de datos ni red, para
// poder probarlas con `node --test`.

import { chooseRecipient, type ContactLike } from "./contacts.ts";

/**
 * Orden de las variables de las plantillas finbra_mora_v1..v3 en Meta:
 * {{1}} nombre, {{2}} monto vencido, {{3}} crédito(s), {{4}} banco,
 * {{5}} beneficiario, {{6}} CLABE.
 */
export const VARIABLES_MORA = ["nombre", "total_vencido", "creditos", "banco", "beneficiario", "clabe"] as const;

export interface MoraCandidate {
  clientId: string;
  nombre: string;
  totalVencido: number;
  creditos: { noCredito: string; totalVencido: number }[];
  pausaHasta: string | null;
  /** juridico o reestructura en alguno de sus créditos. */
  etapa: "juridico" | "reestructura" | null;
  promesaVigente: boolean;
  cuenta: { banco: string; beneficiario: string; clabe: string } | null;
  contactos: (ContactLike & { nombre: string | null })[];
  contactoCobranzaId: string | null;
  /** Ya tiene un recordatorio de mora registrado hoy (enviado, pendiente o fallido). */
  yaSeIntentoHoy: boolean;
  /** Nombre de la última plantilla de mora que se le mandó, para rotar. */
  ultimaPlantilla: string | null;
}

export type MoraDecision =
  | { enviar: true; contactId: string; telefono: string; plantilla: string; parametros: string[] }
  | { enviar: false; motivo: string };

const monto = (n: number) => n.toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** "crédito 2001" o "créditos 2001 y 2002 R". Solo los que tienen saldo vencido. */
export function textoCreditos(creditos: { noCredito: string; totalVencido: number }[]): string {
  const vencidos = creditos.filter((c) => c.totalVencido > 0).map((c) => c.noCredito);
  const lista = vencidos.length ? vencidos : creditos.map((c) => c.noCredito);
  if (lista.length === 1) return `crédito ${lista[0]}`;
  return `créditos ${lista.slice(0, -1).join(", ")} y ${lista.at(-1)}`;
}

/**
 * La siguiente plantilla en la rotación. `activas` va en el orden de rotación;
 * si la última que recibió ya no está activa, empieza por la primera.
 */
export function siguientePlantilla(activas: string[], ultima: string | null): string | null {
  if (activas.length === 0) return null;
  const i = ultima ? activas.indexOf(ultima) : -1;
  return activas[(i + 1) % activas.length];
}

/** Meta rechaza parámetros con saltos de línea, tabuladores o más de 4 espacios seguidos. */
export function limpiarParametro(s: string): string {
  return s.replace(/[\r\n\t]+/g, " ").replace(/ {2,}/g, " ").trim();
}

/**
 * Decide si hoy se le manda el recordatorio de mora a un cliente. Mismas reglas
 * que la cola: en jurídico, en reestructura, pausado o con promesa vigente no
 * se le escribe. Sin cuenta de pago o sin WhatsApp válido del deudor, tampoco.
 */
export function decidirMora(c: MoraCandidate, p: { umbral: number; hoy: string; plantillasActivas: string[] }): MoraDecision {
  if (c.totalVencido < p.umbral) return { enviar: false, motivo: "Saldo vencido menor al umbral de mora" };
  if (c.etapa === "juridico") return { enviar: false, motivo: "En jurídico" };
  if (c.etapa === "reestructura") return { enviar: false, motivo: "En reestructura" };
  if (c.pausaHasta && c.pausaHasta >= p.hoy) return { enviar: false, motivo: "Cobranza pausada" };
  if (c.promesaVigente) return { enviar: false, motivo: "Tiene una promesa de pago vigente" };
  if (!c.cuenta) return { enviar: false, motivo: "Sin cuenta de pago" };
  const rec = chooseRecipient(c.contactos, c.contactoCobranzaId);
  const k = c.contactos.find((x) => x.id === rec.contactId);
  if (!k?.telefonoWhatsapp) return { enviar: false, motivo: "Sin WhatsApp válido del deudor" };
  if (c.yaSeIntentoHoy) return { enviar: false, motivo: "Ya se le envió hoy" };
  const plantilla = siguientePlantilla(p.plantillasActivas, c.ultimaPlantilla);
  if (!plantilla) return { enviar: false, motivo: "No hay plantillas de mora activas" };

  const valores: Record<(typeof VARIABLES_MORA)[number], string> = {
    nombre: k.nombre || c.nombre,
    total_vencido: monto(c.totalVencido),
    creditos: textoCreditos(c.creditos),
    banco: c.cuenta.banco,
    beneficiario: c.cuenta.beneficiario,
    clabe: c.cuenta.clabe,
  };
  return {
    enviar: true,
    contactId: k.id,
    telefono: k.telefonoWhatsapp,
    plantilla,
    parametros: VARIABLES_MORA.map((v) => limpiarParametro(valores[v])),
  };
}

/**
 * Por qué hoy no sale ningún recordatorio, aunque haya clientes que lo
 * recibirían. Lista vacía = se puede enviar.
 */
export function bloqueosDeEnvio(p: {
  ambiente: string;
  activado: boolean;
  configurado: boolean;
  plantillasActivas: number;
  fotoDeHoy: boolean;
  hora: string;
  ventana: { desde: string; hasta: string };
}): string[] {
  const b: string[] = [];
  if (p.ambiente !== "produccion") b.push("Conectado al ambiente de pruebas de SIAC: sus datos no son reales y no se le escribe a nadie");
  if (!p.activado) b.push("El envío automático está apagado");
  if (!p.configurado) b.push("Faltan las variables de WhatsApp en Vercel (WHATSAPP_TOKEN y WHATSAPP_PHONE_NUMBER_ID)");
  if (p.plantillasActivas === 0) b.push("No hay plantillas de mora activas");
  if (!p.fotoDeHoy) b.push("Todavía no hay foto de SIAC de hoy");
  if (p.hora < p.ventana.desde || p.hora >= p.ventana.hasta) b.push(`Fuera del horario de envío (${p.ventana.desde} a ${p.ventana.hasta})`);
  return b;
}
