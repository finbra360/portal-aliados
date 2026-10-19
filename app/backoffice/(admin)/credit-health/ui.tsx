import {
  CLASIFICACION_LABELS,
  ESTADO_CONTACTO_LABELS,
  type Clasificacion,
  type EstadoContacto,
} from "@/lib/credit-health/catalogo";

const CLASE_COLOR: Record<Clasificacion, string> = {
  alta_prioridad: "bg-emerald-100 text-emerald-700",
  revision_analista: "bg-amber-100 text-amber-800",
  informacion_incompleta: "bg-black/5 text-finbra-gray",
  no_elegible: "bg-red-100 text-red-700",
};

export function ClasificacionPill({ valor }: { valor: string }) {
  const v = valor as Clasificacion;
  return (
    <span className={`inline-block whitespace-nowrap rounded-full px-3 py-1 text-xs font-semibold ${CLASE_COLOR[v] ?? "bg-black/5 text-finbra-gray"}`}>
      {CLASIFICACION_LABELS[v] ?? valor}
    </span>
  );
}

const CONTACTO_COLOR: Record<EstadoContacto, string> = {
  nuevo: "bg-finbra-purple/10 text-finbra-purple-700",
  contactado: "bg-sky-100 text-sky-800",
  en_evaluacion: "bg-amber-100 text-amber-800",
  documentacion: "bg-amber-100 text-amber-800",
  convertido: "bg-emerald-100 text-emerald-700",
  no_responde: "bg-black/5 text-finbra-gray",
  descartado: "bg-black/5 text-finbra-gray",
};

export function ContactoPill({ valor }: { valor: string }) {
  const v = valor as EstadoContacto;
  return (
    <span className={`inline-block whitespace-nowrap rounded-full px-3 py-1 text-xs font-semibold ${CONTACTO_COLOR[v] ?? "bg-black/5 text-finbra-gray"}`}>
      {ESTADO_CONTACTO_LABELS[v] ?? valor}
    </span>
  );
}

export function DemoPill() {
  return <span className="inline-block rounded-full border border-dashed border-finbra-purple/40 px-2 py-0.5 text-[10px] font-semibold uppercase text-finbra-purple-700">Demo</span>;
}

const mx = new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN", maximumFractionDigits: 0 });
export const pesos = (v: number | null | undefined) => (v === null || v === undefined || !Number.isFinite(v) ? "—" : mx.format(v));
export const veces = (v: number | null | undefined) => (v === null || v === undefined || !Number.isFinite(v) ? "—" : `${v.toFixed(2)}x`);
export const fechaHora = (d: Date | string) =>
  new Date(d).toLocaleString("es-MX", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "America/Mexico_City" });
export const fecha = (d: Date | string) =>
  new Date(d).toLocaleDateString("es-MX", { day: "2-digit", month: "short", year: "numeric", timeZone: "America/Mexico_City" });

export function ErrorCarga({ texto }: { texto: string }) {
  return <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-red-700">{texto}</div>;
}
