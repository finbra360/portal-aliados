// Gestiones de cobranza que registra el equipo desde el perfil del cliente:
// tipos, resultados y validaciones. Funciones puras, sin base de datos, para
// poder probarlas con `node --test`.

import { addDays, daysBetween } from "./rules.ts";

export const TIPOS_GESTION = {
  llamada: "Llamada",
  nota: "Nota",
  visita: "Visita",
  correo: "Correo",
} as const;
export type TipoGestion = keyof typeof TIPOS_GESTION;

/** Resultado de una llamada o visita (col_activities.resultado). */
export const RESULTADOS = {
  contesto: "Contestó",
  no_contesto: "No contestó",
  numero_equivocado: "Número equivocado",
  promesa: "Prometió pagar",
  se_nego: "Se negó a pagar",
  otro: "Otro",
} as const;
export type Resultado = keyof typeof RESULTADOS;

export const CANALES_PROMESA = { llamada: "Llamada", whatsapp: "WhatsApp", correo: "Correo", visita: "Visita", otro: "Otro" } as const;
export type CanalPromesa = keyof typeof CANALES_PROMESA;

export const ETAPAS = { juridico: "Jurídico", reestructura: "Reestructura" } as const;
export type Etapa = keyof typeof ETAPAS;

/** Más allá de esto, una promesa o una pausa deja de ser seguimiento y es otra cosa (reestructura). */
export const MAX_DIAS_PROMESA = 60;
export const MAX_DIAS_PAUSA = 90;

type Ok<T> = { ok: true } & T;
type Err = { ok: false; error: string };

export function validarGestion(p: {
  tipo: string;
  resultado: string | null;
  descripcion: string;
}): Ok<{ tipo: TipoGestion; resultado: Resultado | null; descripcion: string }> | Err {
  if (!(p.tipo in TIPOS_GESTION)) return { ok: false, error: "Elige qué tipo de gestión fue" };
  const tipo = p.tipo as TipoGestion;
  const conResultado = tipo === "llamada" || tipo === "visita";
  if (conResultado && (!p.resultado || !(p.resultado in RESULTADOS))) return { ok: false, error: "Elige cómo terminó la llamada o visita" };
  const descripcion = p.descripcion.trim();
  if (!conResultado && !descripcion) return { ok: false, error: "Escribe qué pasó" };
  if (descripcion.length > 2000) return { ok: false, error: "La nota es demasiado larga (máximo 2,000 caracteres)" };
  return { ok: true, tipo, resultado: conResultado ? (p.resultado as Resultado) : null, descripcion };
}

/** Monto en pesos a partir de lo que escribe una persona ("12,500.50", "$ 8000"). */
export function parseMonto(raw: string): number | null {
  const limpio = raw.replace(/[$\s,]/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(limpio)) return null;
  const n = Number(limpio);
  return n > 0 ? Math.round(n * 100) / 100 : null;
}

export function validarPromesa(p: { monto: string; fecha: string; hoy: string }): Ok<{ monto: number; fecha: string }> | Err {
  const monto = parseMonto(p.monto);
  if (monto === null) return { ok: false, error: "Escribe un monto válido, mayor a cero" };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(p.fecha)) return { ok: false, error: "Elige la fecha en que prometió pagar" };
  if (p.fecha < p.hoy) return { ok: false, error: "La fecha de la promesa no puede ser pasada" };
  if (daysBetween(p.hoy, p.fecha) > MAX_DIAS_PROMESA) {
    return { ok: false, error: `Una promesa a más de ${MAX_DIAS_PROMESA} días ya es una reestructura; usa la etapa Reestructura` };
  }
  return { ok: true, monto, fecha: p.fecha };
}

export function validarPausa(p: { hasta: string; motivo: string; hoy: string }): Ok<{ hasta: string; motivo: string }> | Err {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(p.hasta)) return { ok: false, error: "Elige hasta qué fecha pausar" };
  if (p.hasta <= p.hoy) return { ok: false, error: "La pausa tiene que terminar después de hoy" };
  if (p.hasta > addDays(p.hoy, MAX_DIAS_PAUSA)) return { ok: false, error: `La pausa no puede durar más de ${MAX_DIAS_PAUSA} días` };
  const motivo = p.motivo.trim();
  if (!motivo) return { ok: false, error: "Escribe por qué se pausa la cobranza" };
  return { ok: true, hasta: p.hasta, motivo };
}

/** Consultas de "saldo al día" a SIAC: a lo más una por crédito en este lapso. */
export const MINUTOS_ENTRE_CONSULTAS_SALDO = 10;

export function puedeConsultarSaldo(ultimaConsulta: Date | null, ahora: Date): { ok: true } | { ok: false; minutos: number } {
  if (!ultimaConsulta) return { ok: true };
  const transcurridos = (ahora.getTime() - ultimaConsulta.getTime()) / 60_000;
  if (transcurridos >= MINUTOS_ENTRE_CONSULTAS_SALDO) return { ok: true };
  return { ok: false, minutos: Math.ceil(MINUTOS_ENTRE_CONSULTAS_SALDO - transcurridos) };
}

/** Hasta dónde se puede pedir el saldo a otra fecha: un año atrás, 120 días adelante. */
export const DIAS_SALDO_ATRAS = 366;
export const DIAS_SALDO_ADELANTE = 120;

const sumarDias = (fecha: string, dias: number) => new Date(Date.parse(`${fecha}T00:00:00Z`) + dias * 86_400_000).toISOString().slice(0, 10);

/**
 * Fecha de corte para ConsultarSaldoCredito. Vacía = hoy. Una fecha futura
 * dice cuánto deberá el cliente ese día (por ejemplo, en su próximo vencimiento).
 */
export function validarFechaSaldo(texto: string | null | undefined, hoy: string): { ok: true; fecha: string } | { ok: false; error: string } {
  const t = String(texto ?? "").trim();
  if (!t) return { ok: true, fecha: hoy };
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t);
  const valida = m && new Date(`${t}T00:00:00Z`).toISOString().slice(0, 10) === t;
  if (!valida) return { ok: false, error: "La fecha no es válida" };
  if (t < sumarDias(hoy, -DIAS_SALDO_ATRAS)) return { ok: false, error: "La fecha no puede ser de hace más de un año" };
  if (t > sumarDias(hoy, DIAS_SALDO_ADELANTE)) return { ok: false, error: `La fecha no puede ser de más de ${DIAS_SALDO_ADELANTE} días adelante` };
  return { ok: true, fecha: t };
}
