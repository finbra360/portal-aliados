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
