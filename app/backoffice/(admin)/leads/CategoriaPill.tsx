import type { LeadCategoria } from "@/lib/db/leads";

const LABELS: Record<LeadCategoria, string> = {
  hot: "Hot",
  warm: "Warm",
  qualified: "Qualified",
  contacto_directo: "Contacto directo",
  discarded: "Discarded",
};

const CLASSES: Record<LeadCategoria, string> = {
  hot: "bg-red-100 text-red-700",
  warm: "bg-amber-100 text-amber-800",
  qualified: "bg-sky-100 text-sky-700",
  contacto_directo: "bg-emerald-100 text-emerald-800",
  discarded: "bg-black/5 text-finbra-gray",
};

export default function CategoriaPill({ categoria }: { categoria: LeadCategoria | null }) {
  if (!categoria) {
    return <span className="inline-block rounded-full bg-finbra-lilac/40 px-3 py-1 text-xs font-semibold text-finbra-purple">Sin calificar</span>;
  }
  return <span className={`inline-block rounded-full px-3 py-1 text-xs font-semibold ${CLASSES[categoria]}`}>{LABELS[categoria]}</span>;
}
