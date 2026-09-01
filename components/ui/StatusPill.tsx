export type OperationStatus =
  | "recibida"
  | "documentacion_pendiente"
  | "en_analisis"
  | "aprobada"
  | "formalizacion"
  | "fondeada"
  | "rechazada";

const STATUS_LABELS: Record<OperationStatus, string> = {
  recibida: "Recibida",
  documentacion_pendiente: "Documentación pendiente",
  en_analisis: "En análisis",
  aprobada: "Aprobada",
  formalizacion: "Formalización",
  fondeada: "Fondeada",
  rechazada: "Rechazada",
};

const STATUS_CLASSES: Record<OperationStatus, string> = {
  recibida: "bg-black/5 text-finbra-gray",
  documentacion_pendiente: "bg-amber-100 text-amber-800",
  en_analisis: "bg-finbra-purple/10 text-finbra-purple",
  aprobada: "bg-sky-100 text-sky-700",
  formalizacion: "bg-sky-100 text-sky-700",
  fondeada: "bg-emerald-100 text-emerald-700",
  rechazada: "bg-red-100 text-red-700",
};

export default function StatusPill({ status }: { status: OperationStatus }) {
  return (
    <span className={`inline-block rounded-full px-3 py-1 text-xs font-semibold ${STATUS_CLASSES[status]}`}>
      {STATUS_LABELS[status]}
    </span>
  );
}
