import { plazoDe } from "@/lib/clientes/tareas";
import { formatFecha } from "@/lib/format";

const CLASE = {
  vencida: "bg-red-100 text-red-800",
  hoy: "bg-amber-100 text-amber-800",
  semana: "bg-finbra-purple/10 text-finbra-purple-700",
  despues: "bg-black/5 text-finbra-gray",
} as const;

/** Fecha límite de una tarea con su color: vencida, hoy, esta semana o después. */
export default function PlazoChip({ venceEl, hoy }: { venceEl: string; hoy: string }) {
  const plazo = plazoDe(venceEl, hoy);
  const dias = Math.round((Date.parse(hoy) - Date.parse(venceEl)) / 86_400_000);
  const texto =
    plazo === "vencida" ? `Vencida hace ${dias} ${dias === 1 ? "día" : "días"}` : plazo === "hoy" ? "Hoy" : formatFecha(venceEl);
  return <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold ${CLASE[plazo]}`}>{texto}</span>;
}
