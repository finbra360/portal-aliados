import { ETIQUETA_ETAPA, type EtapaNegocio } from "@/lib/clientes/negocios";

const CLASE: Partial<Record<EtapaNegocio, string>> = {
  dispersado: "bg-emerald-100 text-emerald-800",
  pospuesto: "bg-amber-100 text-amber-800",
  rechazado: "bg-black/5 text-finbra-gray",
};

/** Etapa de un negocio de crédito. Las abiertas van en morado; los cierres, cada uno en su color. */
export default function EtapaNegocioChip({ etapa }: { etapa: EtapaNegocio }) {
  return (
    <span className={`inline-block whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold ${CLASE[etapa] ?? "bg-finbra-purple/10 text-finbra-purple-700"}`}>
      {ETIQUETA_ETAPA[etapa]}
    </span>
  );
}
