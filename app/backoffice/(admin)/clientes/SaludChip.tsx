import { NIVELES_SALUD, type NivelSalud, type Salud } from "@/lib/clientes/salud";

const ESTILO: Record<NivelSalud, { clase: string; punto: string }> = {
  sana: { clase: "bg-emerald-100 text-emerald-800", punto: "bg-emerald-500" },
  atencion: { clase: "bg-amber-100 text-amber-800", punto: "bg-amber-500" },
  riesgo: { clase: "bg-red-100 text-red-700", punto: "bg-red-500" },
};

/**
 * Salud del cliente: cómo va la relación hoy (lib/clientes/salud.ts). Es
 * distinta del semáforo de pago, que resume su historia en SIAC. Al pasar el
 * cursor muestra qué le restó puntos.
 */
export default function SaludChip({ salud, puntos = true }: { salud: Salud | null; /** Muestra los puntos junto al nivel. */ puntos?: boolean }) {
  if (!salud) return <span className="text-finbra-gray">—</span>;
  const e = ESTILO[salud.nivel];
  const titulo = salud.razones.length
    ? `Salud ${salud.puntos}/100: ${salud.razones.map((r) => `${r.texto} (−${r.puntos})`).join(" · ")}`
    : "Salud 100/100: nada le resta";
  return (
    <span title={titulo} className={`inline-flex w-fit items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold ${e.clase}`}>
      <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${e.punto}`} />
      {NIVELES_SALUD[salud.nivel]}
      {puntos && <span className="font-normal tabular-nums">· {salud.puntos}</span>}
    </span>
  );
}
