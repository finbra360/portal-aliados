// Recordatorios de cobranza por correo: a quién, con qué asunto y qué texto.
// Mismas reglas que el WhatsApp (motivoComunPreventivo / motivoComunMora) y los
// textos que mandaba n8n, con los datos de SIAC y la cuenta de pago del
// backoffice. Funciones puras, sin base de datos ni red.

import { ETAPAS, baseDecision, etapaDelTexto, fechaLarga, motivoComunPreventivo, motivoMonto, type Etapa, type PreventivoCandidate, type Semaforo, type UmbralesSemaforo } from "./preventivos.ts";
import { motivoComunMora, textoCreditos, type MoraCandidate } from "./whatsapp-mora.ts";

/** Lo que n8n ponía al final de cada correo. */
const CONTACTO_FINBRA = "Para cualquier duda, contáctanos por WhatsApp al 5539001768 o responde este correo.";
const FIRMA = "Equipo Finbra<br>hola@finbra.com | finbra.com";

export interface Correo {
  destinatarios: string[];
  asunto: string;
  html: string;
}

export type CorreoDecision = ({ enviar: true } & Correo) | { enviar: false; motivo: string };

/** Para meter texto de SIAC o del equipo dentro del HTML sin romperlo. */
export function escapar(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

const pesos = (n: number) => `$${n.toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} MXN`;

/** Correos válidos y sin repetir (sin importar mayúsculas). */
export function correosValidos(lista: string[]): string[] {
  const vistos = new Set<string>();
  const out: string[] = [];
  for (const raw of lista) {
    const c = raw.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c) || vistos.has(c)) continue;
    vistos.add(c);
    out.push(c);
  }
  return out;
}

function datosDeposito(cuenta: { banco: string; beneficiario: string; clabe: string }, concepto: string): string {
  return (
    "<p>Los datos de depósito son los siguientes:</p>\n<ul>\n" +
    `  <li><b>Banco:</b> ${escapar(cuenta.banco)}</li>\n` +
    `  <li><b>Beneficiario:</b> ${escapar(cuenta.beneficiario)}</li>\n` +
    `  <li><b>CLABE:</b> ${escapar(cuenta.clabe)}</li>\n` +
    `  <li><b>Concepto:</b> ${escapar(concepto)}</li>\n</ul>\n`
  );
}

const ASUNTO_PREVENTIVO: Record<Etapa, string> = {
  "5d": "Recordatorio de pago — Finbra",
  "1d": "Tu pago vence mañana — Finbra",
  dia: "Tu pago vence hoy — Finbra",
};

/** Texto del preventivo según cuándo vence de verdad (etapaDelTexto), como los de n8n. */
export function correoPreventivo(p: {
  textoEtapa: Etapa;
  cliente: string;
  noCredito: string;
  monto: number;
  vencimiento: string;
  cuenta: { banco: string; beneficiario: string; clabe: string };
}): { asunto: string; html: string } {
  const cuando = p.textoEtapa === "dia" ? "que vence <b>hoy</b>" : p.textoEtapa === "1d" ? "que vence <b>mañana</b>" : "próximo a vencer";
  const cierre =
    p.textoEtapa === "dia"
      ? "<p>Si ya realizaste tu pago, ¡muchas gracias! Si tienes alguna situación, escríbenos: podemos apoyarte.</p>\n"
      : p.textoEtapa === "1d"
        ? "<p>Si ya realizaste tu pago, ignora este mensaje.</p>\n"
        : "";
  const html =
    "<p>Estimado/a cliente:</p>\n" +
    `<p>Le informamos que <b>${escapar(p.cliente)}</b> tiene un pago ${cuando}:</p>\n<ul>\n` +
    `  <li><b>Crédito:</b> ${escapar(p.noCredito)}</li>\n` +
    `  <li><b>Monto:</b> ${pesos(p.monto)}</li>\n` +
    `  <li><b>Fecha de vencimiento:</b> ${fechaLarga(p.vencimiento)}</li>\n</ul>\n` +
    datosDeposito(p.cuenta, p.noCredito) +
    cierre +
    `<p>${CONTACTO_FINBRA}</p>\n<p>${FIRMA}</p>`;
  return { asunto: ASUNTO_PREVENTIVO[p.textoEtapa], html };
}

export function correoMora(p: {
  cliente: string;
  totalVencido: number;
  creditos: { noCredito: string; totalVencido: number }[];
  cuenta: { banco: string; beneficiario: string; clabe: string };
}): { asunto: string; html: string } {
  const creditos = textoCreditos(p.creditos);
  const concepto = creditos.replace(/^créditos? /, "");
  const html =
    "<p>Estimado/a cliente:</p>\n" +
    `<p>Le informamos que <b>${escapar(p.cliente)}</b> presenta un saldo vencido con Finbra:</p>\n<ul>\n` +
    `  <li><b>Saldo vencido:</b> ${pesos(p.totalVencido)}</li>\n` +
    `  <li><b>${creditos.startsWith("créditos") ? "Créditos" : "Crédito"}:</b> ${escapar(concepto)}</li>\n</ul>\n` +
    "<p>Para ponerse al corriente, puede transferir con estos datos:</p>\n" +
    datosDeposito(p.cuenta, concepto).replace("<p>Los datos de depósito son los siguientes:</p>\n", "") +
    "<p>Si ya realizó su pago, no tome en cuenta este mensaje. Si necesita apoyo o acordar una fecha, responda este correo.</p>\n" +
    `<p>${CONTACTO_FINBRA}</p>\n<p>${FIRMA}</p>`;
  return { asunto: "Saldo vencido de tu crédito — Finbra", html };
}

/** Preventivo por correo: null si hoy no le toca recordatorio. */
export function decidirCorreoPreventivo(
  c: PreventivoCandidate,
  p: { hoy: string; umbrales?: UmbralesSemaforo; cubiertos?: string[]; yaSeEnvio: boolean },
): ({ etapa: Etapa; semaforo: Semaforo; adelantado: boolean } & CorreoDecision) | null {
  const base = baseDecision(c, p);
  if (!base) return null;
  const { etapa, s, adelantado } = base;
  const no = (motivo: string) => ({ etapa, semaforo: s, adelantado, enviar: false as const, motivo });
  const comun = motivoComunPreventivo(c, etapa, s, p.hoy);
  if (comun) return no(comun);
  const destinatarios = correosValidos(c.correos);
  if (destinatarios.length === 0) return no("Sin correo del deudor");
  if (p.yaSeEnvio) return no("Ya se le envió este recordatorio por correo");
  const porMonto = motivoMonto(c.monto);
  if (porMonto || c.monto === null || !c.cuenta) return no(porMonto ?? "Sin cuenta de pago");
  const textoEtapa = etapaDelTexto(p.hoy, c.proximoVencimiento!);
  const correo = correoPreventivo({ textoEtapa, cliente: c.nombre, noCredito: c.noCredito, monto: c.monto, vencimiento: c.proximoVencimiento!, cuenta: c.cuenta });
  return { etapa, semaforo: s, adelantado, enviar: true, destinatarios, ...correo };
}

/** Mora por correo: mismas reglas que el WhatsApp de mora, uno al día. */
export function decidirCorreoMora(c: MoraCandidate, p: { umbral: number; hoy: string; yaSeEnvioHoy: boolean }): CorreoDecision {
  const comun = motivoComunMora(c, p);
  if (comun || !c.cuenta) return { enviar: false, motivo: comun ?? "Sin cuenta de pago" };
  const destinatarios = correosValidos(c.correos);
  if (destinatarios.length === 0) return { enviar: false, motivo: "Sin correo del deudor" };
  if (p.yaSeEnvioHoy) return { enviar: false, motivo: "Ya se le envió hoy por correo" };
  return { enviar: true, destinatarios, ...correoMora({ cliente: c.nombre, totalVencido: c.totalVencido, creditos: c.creditos, cuenta: c.cuenta }) };
}

export const etiquetaEtapa = (e: Etapa, adelantado: boolean) => `${ETAPAS[e].etiqueta}${adelantado ? " (adelantado por día inhábil)" : ""}`;
