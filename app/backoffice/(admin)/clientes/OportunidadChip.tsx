import { ESTADOS_OPORTUNIDAD, type EstadoOportunidad } from "@/lib/clientes/renovaciones";

const CLASE: Record<EstadoOportunidad, string> = {
  abierta: "bg-finbra-purple/10 text-finbra-purple-700",
  en_contacto: "bg-amber-100 text-amber-800",
  interesado: "bg-emerald-100 text-emerald-800",
  ganada: "bg-emerald-600 text-white",
  descartada: "bg-black/5 text-finbra-gray",
  cerrada: "bg-black/5 text-finbra-gray",
};

/** Estado de una oportunidad de renovación. */
export default function OportunidadChip({ estado }: { estado: EstadoOportunidad }) {
  return <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold ${CLASE[estado]}`}>{ESTADOS_OPORTUNIDAD[estado]}</span>;
}
