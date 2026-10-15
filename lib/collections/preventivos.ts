// Recordatorios preventivos por WhatsApp (5 días antes, 1 día antes y el día
// del pago), que reemplazan al flujo de n8n que leía el Google Sheet. La fecha
// sale de SIAC (ProximoVencimiento) y el semáforo se calcula con el historial
// de SIAC. Funciones puras, sin base de datos ni red, para probarlas con
// `node --test`.

import { chooseRecipient, type ContactLike } from "./contacts.ts";
import { daysBetween } from "./rules.ts";
import { limpiarParametro } from "./whatsapp-mora.ts";

export type Etapa = "5d" | "1d" | "dia";

/**
 * Plantillas propias del backoffice, con la cuenta de pago del cliente dentro
 * del mensaje (las recordatorio_pago_* de n8n mandaban a buscarla al correo).
 */
export const ETAPAS: Record<Etapa, { dias: number; plantilla: string; etiqueta: string }> = {
  "5d": { dias: 5, plantilla: "finbra_preventivo_5d", etiqueta: "5 días antes" },
  "1d": { dias: 1, plantilla: "finbra_preventivo_1d", etiqueta: "1 día antes" },
  dia: { dias: 0, plantilla: "finbra_preventivo_dia", etiqueta: "el día del pago" },
};

/** {{1}} nombre, {{2}} crédito, {{3}} monto, {{4}} fecha, {{5}} banco, {{6}} beneficiario, {{7}} CLABE. */
export const VARIABLES_PREVENTIVA = ["nombre", "credito", "monto", "fecha", "banco", "beneficiario", "clabe"] as const;

/** Textos que el backoffice da de alta en Meta ("Crear plantillas en Meta"). Utilidad, es_MX. */
export const PLANTILLAS_PREVENTIVAS: { nombre: string; cuerpo: string }[] = [
  {
    nombre: "finbra_preventivo_5d",
    cuerpo:
      "Hola {{1}}, te recordamos que el pago de tu {{2}} con Finbra por ${{3}} MXN vence el {{4}}. Puedes pagar por transferencia a {{5}}, a nombre de {{6}}, CLABE {{7}}, anotando tu número de crédito en el concepto. Si tienes dudas, responde este mensaje.",
  },
  {
    nombre: "finbra_preventivo_1d",
    cuerpo:
      "Hola {{1}}, el pago de tu {{2}} con Finbra por ${{3}} MXN vence mañana, {{4}}. Transfiere a {{5}}, a nombre de {{6}}, CLABE {{7}}, y anota tu número de crédito en el concepto. Si ya realizaste tu pago, no tomes en cuenta este mensaje.",
  },
  {
    nombre: "finbra_preventivo_dia",
    cuerpo:
      "Hola {{1}}, hoy vence el pago de tu {{2}} con Finbra por ${{3}} MXN ({{4}}). Puedes transferir a {{5}}, a nombre de {{6}}, CLABE {{7}}, con tu número de crédito en el concepto. Si ya pagaste, ¡gracias! Si necesitas apoyo, responde este mensaje.",
  },
];

/** Ejemplos ficticios de las 7 variables, para la revisión de Meta. */
export const EJEMPLO_PREVENTIVA = ["Juan Pérez", "crédito 2001", "18,500.00", "20 de octubre de 2026", "BBVA", "Litore Avances SAPI de CV SOFOM ENR", "032180000118359719"];

export type Semaforo = "verde" | "amarillo" | "rojo";

export interface UmbralesSemaforo {
  /** Veces en mora a partir de las cuales es rojo. */
  rojoVeces: number;
  /** Atraso máximo (días) por encima del cual es rojo. */
  rojoAtraso: number;
}

export const UMBRALES_SEMAFORO_DEFAULT: UmbralesSemaforo = { rojoVeces: 3, rojoAtraso: 30 };

/**
 * Semáforo del cliente con su historial en SIAC (lo peor de sus créditos):
 * rojo si cayó en mora muchas veces o tuvo un atraso largo; amarillo si alguna
 * vez se atrasó; verde si nunca.
 */
export function semaforo(h: { vecesMora: number; atrasoMaximo: number }, u: UmbralesSemaforo = UMBRALES_SEMAFORO_DEFAULT): Semaforo {
  if (h.vecesMora >= u.rojoVeces || h.atrasoMaximo > u.rojoAtraso) return "rojo";
  if (h.vecesMora > 0 || h.atrasoMaximo > 0) return "amarillo";
  return "verde";
}

/** Qué recordatorio toca hoy para un vencimiento, o null si ninguno. */
export function etapaPara(hoy: string, proximoVencimiento: string | null): Etapa | null {
  if (!proximoVencimiento) return null;
  const d = daysBetween(hoy, proximoVencimiento);
  return (Object.keys(ETAPAS) as Etapa[]).find((e) => ETAPAS[e].dias === d) ?? null;
}

/**
 * Mismas reglas que n8n: 5 días antes solo a los rojos, 1 día antes a todos
 * menos los verdes, y el día del pago a todos.
 */
export function motivoSemaforo(etapa: Etapa, s: Semaforo): string | null {
  if (etapa === "5d" && s !== "rojo") return `Semáforo ${s}: 5 días antes solo se escribe a los rojos`;
  if (etapa === "1d" && s === "verde") return "Semáforo verde: 1 día antes no se le escribe";
  return null;
}

const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

/** "2026-10-20" → "20 de octubre de 2026". */
export function fechaLarga(iso: string): string {
  const [a, m, d] = iso.split("-").map(Number);
  return `${d} de ${MESES[m - 1]} de ${a}`;
}

export interface PreventivoCandidate {
  creditId: string;
  clientId: string;
  noCredito: string;
  nombre: string;
  proximoVencimiento: string | null;
  fechaUltimoPago: string | null;
  /** Lo peor de todos los créditos del cliente. */
  historial: { vecesMora: number; atrasoMaximo: number };
  /** El cliente está en mora (vencido ≥ umbral): le toca el recordatorio de mora, no el preventivo. */
  enMora: boolean;
  etapaManual: "juridico" | "reestructura" | null;
  pausaHasta: string | null;
  contactos: (ContactLike & { nombre: string | null })[];
  contactoCobranzaId: string | null;
  /** Ya tiene registrado este recordatorio (mismo crédito, etapa y vencimiento). */
  yaSeIntento: boolean;
  /** Monto de la mensualidad según SIAC, o null si SIAC todavía no lo da. */
  monto: number | null;
  /** Cuenta de pago del cliente (Cuentas de pago), o null si no tiene. */
  cuenta: { banco: string; beneficiario: string; clabe: string } | null;
}

export type PreventivoDecision = { etapa: Etapa; semaforo: Semaforo; aviso: string | null } & (
  | { enviar: true; contactId: string; telefono: string; plantilla: string; parametros: string[] }
  | { enviar: false; motivo: string }
);

const montoTexto = (n: number) => n.toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Días entre el último pago y el vencimiento para avisar que tal vez ya pagó por adelantado. */
export const DIAS_PAGO_RECIENTE = 20;

/**
 * Decide el recordatorio preventivo de hoy para un crédito. Regresa null si hoy
 * no le toca ninguno (no vence en 5, 1 o 0 días).
 */
export function decidirPreventivo(
  c: PreventivoCandidate,
  p: { hoy: string; plantillasActivas: string[]; umbrales?: UmbralesSemaforo },
): PreventivoDecision | null {
  const etapa = etapaPara(p.hoy, c.proximoVencimiento);
  if (!etapa) return null;
  const s = semaforo(c.historial, p.umbrales);
  // SIAC todavía no confirma si ProximoVencimiento avanza cuando el cliente paga
  // por adelantado: no se bloquea, pero se avisa para revisarlo.
  const aviso =
    c.fechaUltimoPago && c.proximoVencimiento && daysBetween(c.fechaUltimoPago, c.proximoVencimiento) <= DIAS_PAGO_RECIENTE
      ? `Pagó el ${c.fechaUltimoPago}: revisa si ya cubrió esta mensualidad`
      : null;
  const no = (motivo: string): PreventivoDecision => ({ etapa, semaforo: s, aviso, enviar: false, motivo });

  if (c.etapaManual === "juridico") return no("En jurídico");
  if (c.etapaManual === "reestructura") return no("En reestructura");
  if (c.pausaHasta && c.pausaHasta >= p.hoy) return no("Cobranza pausada");
  if (c.enMora) return no("En mora: recibe el recordatorio de mora");
  const porSemaforo = motivoSemaforo(etapa, s);
  if (porSemaforo) return no(porSemaforo);
  if (!c.cuenta) return no("Sin cuenta de pago");
  const rec = chooseRecipient(c.contactos, c.contactoCobranzaId);
  const k = c.contactos.find((x) => x.id === rec.contactId);
  if (!k?.telefonoWhatsapp) return no("Sin WhatsApp válido del deudor");
  if (c.yaSeIntento) return no("Ya se le envió este recordatorio");
  const plantilla = ETAPAS[etapa].plantilla;
  if (!p.plantillasActivas.includes(plantilla)) return no(`La plantilla ${plantilla} no está activa`);
  if (c.monto === null) return no("Falta el monto de la mensualidad (pendiente de SIAC)");

  return {
    etapa,
    semaforo: s,
    aviso,
    enviar: true,
    contactId: k.id,
    telefono: k.telefonoWhatsapp,
    plantilla,
    parametros: [
      k.nombre || c.nombre,
      `crédito ${c.noCredito}`,
      montoTexto(c.monto),
      fechaLarga(c.proximoVencimiento!),
      c.cuenta.banco,
      c.cuenta.beneficiario,
      c.cuenta.clabe,
    ].map(limpiarParametro),
  };
}

