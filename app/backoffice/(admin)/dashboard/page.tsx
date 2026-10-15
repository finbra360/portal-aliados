import { redirect } from "next/navigation";

// El Dashboard ejecutivo pasó a Brokers → Resumen. Se deja la ruta vieja para
// que los enlaces y marcadores guardados sigan funcionando.
export default function DashboardMovido() {
  redirect("/backoffice/brokers/resumen");
}
