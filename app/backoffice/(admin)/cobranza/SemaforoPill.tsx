import type { Semaforo } from "@/lib/collections/preventivos";

const ESTILO: Record<Semaforo, { texto: string; clase: string; punto: string }> = {
  verde: { texto: "Sin atrasos", clase: "bg-emerald-100 text-emerald-800", punto: "bg-emerald-500" },
  amarillo: { texto: "Algún atraso", clase: "bg-amber-100 text-amber-800", punto: "bg-amber-500" },
  rojo: { texto: "Atrasos graves", clase: "bg-red-100 text-red-700", punto: "bg-red-500" },
};

/**
 * Semáforo de comportamiento de pago con el historial de SIAC (lo peor de sus
 * créditos vigentes). Es el mismo que decide los recordatorios preventivos; no
 * es una calificación de riesgo.
 */
export default function SemaforoPill({
  semaforo,
  historial,
  detalle = false,
}: {
  semaforo: Semaforo | null;
  historial: { vecesMora: number; atrasoMaximo: number } | null;
  /** Muestra debajo cuántas veces cayó en mora y su peor atraso. */
  detalle?: boolean;
}) {
  if (!semaforo || !historial) return <span className="text-finbra-gray">—</span>;
  const e = ESTILO[semaforo];
  const resumen =
    historial.vecesMora === 0 && historial.atrasoMaximo === 0
      ? "Nunca ha caído en mora"
      : `${historial.vecesMora} ${historial.vecesMora === 1 ? "vez" : "veces"} en mora · peor atraso ${historial.atrasoMaximo} ${historial.atrasoMaximo === 1 ? "día" : "días"}`;
  return (
    <span className="inline-flex flex-col gap-0.5">
      <span title={`Historial en SIAC: ${resumen}`} className={`inline-flex w-fit items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold ${e.clase}`}>
        <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${e.punto}`} />
        {e.texto}
      </span>
      {detalle && <span className="text-xs text-finbra-gray">{resumen}</span>}
    </span>
  );
}
