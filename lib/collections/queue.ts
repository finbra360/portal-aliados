// Cola de trabajo de cobranza: a quién contactar primero y por qué. Reglas
// fijas, sin puntajes: cada cliente cae en el primer nivel que le aplica y
// dentro de cada nivel se ordena por monto vencido. Función pura, sin base de
// datos, para poder probarla y auditarla.

import { addDays, daysBetween } from "./rules.ts";
import { formatFecha } from "../format.ts";

const formatMoneyCorto = (n: number) =>
  new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN", minimumFractionDigits: 2 }).format(n);

/** Días sin una gestión humana para que un cliente en mora pida seguimiento. */
export const DIAS_SIN_GESTION = 7;

export interface QueueClient {
  clientId: string;
  cliente: string;
  numeroCliente: string;
  creditos: { noCredito: string; antiguedad: number; totalVencido: number }[];
  totalVencido: number;
  maxAntiguedad: number;
  /** Tipos de alerta abiertas del cliente. */
  alertas: string[];
  promesaVigente: { fechaCompromiso: string; monto: number } | null;
  /** Fecha (YYYY-MM-DD) de la última gestión hecha por una persona. */
  ultimaGestion: string | null;
  /** Tiene un teléfono principal del titular que sirve para WhatsApp. */
  telefonoValido: boolean;
  pausaHasta: string | null;
  etapaManual: "juridico" | "reestructura" | "pausado" | null;
}

export type Nivel = 1 | 2 | 3 | 4 | 5 | 6;

export interface QueueItem extends QueueClient {
  /** cola: trabajar hoy. espera: tiene promesa vigente o pausa. juridico: lo lleva jurídico. */
  lugar: "cola" | "espera" | "juridico";
  nivel: Nivel | null;
  motivos: string[];
  accion: string;
}

const NIVELES: Record<Nivel, { motivo: (c: QueueClient, hoy: string) => string; accion: string }> = {
  1: { motivo: () => "Incumplió su promesa de pago", accion: "Llamar hoy y renegociar la fecha" },
  2: { motivo: () => "Venció otra mensualidad sin pago", accion: "Llamar hoy" },
  3: { motivo: (c) => `${c.maxAntiguedad} días de atraso`, accion: "Evaluar escalamiento: jurídico o reestructura" },
  4: { motivo: () => "Entró a mora", accion: "Primer contacto: confirmar fecha de pago" },
  5: {
    motivo: (c, hoy) => (c.ultimaGestion ? `Sin gestión desde hace ${daysBetween(c.ultimaGestion, hoy)} días` : "Nunca se ha gestionado"),
    accion: "Dar seguimiento",
  },
  6: { motivo: () => "En mora", accion: "Seguimiento" },
};

function niveles(c: QueueClient, hoy: string): Nivel[] {
  const n: Nivel[] = [];
  if (c.alertas.includes("promesa_incumplida")) n.push(1);
  if (c.alertas.includes("nueva_mensualidad_vencida")) n.push(2);
  if (c.maxAntiguedad > 60) n.push(3);
  if (c.alertas.includes("entrada_mora")) n.push(4);
  if (!c.ultimaGestion || c.ultimaGestion <= addDays(hoy, -DIAS_SIN_GESTION)) n.push(5);
  n.push(6);
  return n;
}

/**
 * Arma la cola a partir de los clientes con saldo vencido. Entran los que
 * están en mora (vencido ≥ umbral) o que incumplieron una promesa.
 */
export function buildQueue(clientes: QueueClient[], umbral: number, hoy: string): QueueItem[] {
  const items: QueueItem[] = [];
  for (const c of clientes) {
    const enMora = c.totalVencido >= umbral;
    if (!enMora && !c.alertas.includes("promesa_incumplida")) continue;

    const extras = c.telefonoValido ? [] : ["Sin teléfono válido para WhatsApp: corregir en SIAC"];

    if (c.etapaManual === "juridico") {
      items.push({ ...c, lugar: "juridico", nivel: null, motivos: ["En jurídico", ...extras], accion: "Seguimiento de jurídico" });
      continue;
    }
    const pausado = c.etapaManual === "pausado" || (c.pausaHasta !== null && c.pausaHasta >= hoy);
    if (pausado) {
      const motivo = c.pausaHasta && c.pausaHasta >= hoy ? `Cobranza pausada hasta el ${formatFecha(c.pausaHasta)}` : "Cobranza pausada";
      items.push({ ...c, lugar: "espera", nivel: null, motivos: [motivo, ...extras], accion: "Esperar" });
      continue;
    }
    if (c.promesaVigente && c.promesaVigente.fechaCompromiso >= hoy) {
      items.push({
        ...c,
        lugar: "espera",
        nivel: null,
        motivos: [`Prometió pagar ${formatMoneyCorto(c.promesaVigente.monto)} el ${formatFecha(c.promesaVigente.fechaCompromiso)}`, ...extras],
        accion: "Esperar el pago prometido",
      });
      continue;
    }

    const aplican = niveles(c, hoy);
    const nivel = aplican[0];
    const motivos = [...new Set(aplican.filter((n) => n !== 6 || aplican.length === 1).map((n) => NIVELES[n].motivo(c, hoy)))];
    items.push({
      ...c,
      lugar: "cola",
      nivel,
      motivos: [...motivos, ...extras],
      accion: c.telefonoValido ? NIVELES[nivel].accion : `${NIVELES[nivel].accion} (por llamada; su WhatsApp no es válido)`,
    });
  }

  const orden = { cola: 0, espera: 1, juridico: 2 } as const;
  return items.sort(
    (a, b) => orden[a.lugar] - orden[b.lugar] || (a.nivel ?? 9) - (b.nivel ?? 9) || b.totalVencido - a.totalVencido,
  );
}
