// Seguimiento de una solicitud en proceso: qué pasos lleva, cuándo llegó a cada
// uno y dónde está ahora. Lógica pura para probarla con `node --test`.

import type { OperationStatus } from "../components/ui/StatusPill.tsx";

/** El camino normal de una solicitud. "Documentación" es el paso donde Finbra puede pedir algo al cliente. */
export const PASOS: { etapa: OperationStatus; nombre: string }[] = [
  { etapa: "recibida", nombre: "Recibida" },
  { etapa: "documentacion_pendiente", nombre: "Documentación" },
  { etapa: "en_analisis", nombre: "En análisis" },
  { etapa: "aprobada", nombre: "Aprobada" },
  { etapa: "formalizacion", nombre: "Formalización" },
  { etapa: "fondeada", nombre: "Fondeada" },
];

export interface EtapaRegistrada {
  etapa: OperationStatus;
  /** ISO */
  fecha: string;
}

export interface PasoSeguimiento {
  etapa: OperationStatus;
  nombre: string;
  estado: "hecho" | "actual" | "pendiente" | "rechazada";
  /** Primera vez que la solicitud llegó a este paso; null si no hay registro. */
  fecha: string | null;
}

/**
 * Pasos del camino con su estado según la etapa actual. Una solicitud puede
 * regresar (p. ej. de "En análisis" a "Documentación"): los pasos de adelante
 * vuelven a quedar pendientes. Si fue rechazada, los pasos que sí alcanzó
 * quedan hechos y se agrega el paso "Rechazada" al final.
 */
export function pasosDeSeguimiento(etapaActual: OperationStatus, historial: EtapaRegistrada[]): PasoSeguimiento[] {
  const primera = new Map<OperationStatus, string>();
  for (const h of [...historial].sort((a, b) => Date.parse(a.fecha) - Date.parse(b.fecha))) {
    if (!primera.has(h.etapa)) primera.set(h.etapa, h.fecha);
  }

  if (etapaActual === "rechazada") {
    const ultimo = Math.max(-1, ...PASOS.map((p, i) => (primera.has(p.etapa) ? i : -1)));
    const pasos: PasoSeguimiento[] = PASOS.slice(0, ultimo + 1).map((p) => ({
      ...p,
      estado: "hecho",
      fecha: primera.get(p.etapa) ?? null,
    }));
    pasos.push({ etapa: "rechazada", nombre: "Rechazada", estado: "rechazada", fecha: primera.get("rechazada") ?? null });
    return pasos;
  }

  const actual = PASOS.findIndex((p) => p.etapa === etapaActual);
  return PASOS.map((p, i) => ({
    ...p,
    estado: i < actual ? "hecho" : i === actual ? "actual" : "pendiente",
    fecha: i <= actual ? (primera.get(p.etapa) ?? null) : null,
  }));
}

/** Días enteros desde `desde` hasta `hasta` (ISO), nunca negativo. */
export function diasEntre(desde: string, hasta: string): number {
  return Math.max(0, Math.floor((Date.parse(hasta) - Date.parse(desde)) / 86_400_000));
}

// ---------------------------------------------------------------- negocios (fase O4)
// Desde la fase O4 las solicitudes de los brokers son negocios de crédito
// (lib/clientes/negocios.ts). El broker sigue viendo sus seis pasos de siempre.

const ETAPA_BROKER: Record<string, OperationStatus> = {
  prospecto: "recibida",
  calificado: "recibida",
  solicitud: "documentacion_pendiente",
  analisis: "en_analisis",
  oferta: "en_analisis",
  expediente: "en_analisis",
  comite: "en_analisis",
  formalizacion: "formalizacion",
  dispersado: "fondeada",
  rechazado: "rechazada",
};

/**
 * Lo que ve el broker de la etapa de un negocio. Un pospuesto se sigue viendo
 * en la etapa en que estaba antes de pausarse (`antesDePausa`).
 */
export function etapaParaBroker(etapa: string, antesDePausa: string | null = null): OperationStatus {
  if (etapa === "pospuesto") return ETAPA_BROKER[antesDePausa ?? ""] ?? "recibida";
  return ETAPA_BROKER[etapa] ?? "recibida";
}

/**
 * Historial del negocio en pasos del broker: cada cambio de etapa traducido,
 * sin repetir el mismo paso seguido (Análisis → Oferta sigue siendo «En
 * análisis») y sin los pospuestos (el broker no ve la pausa).
 */
export function historialParaBroker(cambios: { a: string; de: string | null; fecha: string }[]): EtapaRegistrada[] {
  const fuera: EtapaRegistrada[] = [];
  for (const c of [...cambios].sort((x, y) => Date.parse(x.fecha) - Date.parse(y.fecha))) {
    if (c.a === "pospuesto") continue;
    const etapa = etapaParaBroker(c.a);
    if (fuera[fuera.length - 1]?.etapa !== etapa) fuera.push({ etapa, fecha: c.fecha });
  }
  return fuera;
}
