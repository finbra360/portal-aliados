import { ETAPAS_CICLO, type EtapaCiclo } from "@/lib/clientes/lista";

const CLASE: Record<EtapaCiclo, string> = {
  activo: "bg-emerald-100 text-emerald-800",
  por_liquidar: "bg-finbra-purple/10 text-finbra-purple-700",
  cobranza_especial: "bg-red-100 text-red-700",
  ex_cliente: "bg-black/5 text-finbra-gray",
  sin_creditos: "bg-black/5 text-finbra-gray",
};

/** Dónde está la relación con el cliente; se deriva de sus créditos (lib/clientes/lista.ts). */
export default function EtapaChip({ etapa }: { etapa: EtapaCiclo }) {
  return <span className={`inline-block whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold ${CLASE[etapa]}`}>{ETAPAS_CICLO[etapa]}</span>;
}
