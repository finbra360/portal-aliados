import Link from "next/link";
import { getAdminSession } from "@/lib/get-admin-session";
import { requireRole } from "@/lib/rbac";
import ColocacionImportarPanel from "./ColocacionImportarPanel";
import { COLOCACION_EDITAN } from "../roles";

export default async function CargaColocacionPage() {
  requireRole(await getAdminSession(), COLOCACION_EDITAN);
  return (
    <div className="space-y-6">
      <div>
        <Link href="/backoffice/brokers" className="text-sm text-finbra-gray hover:text-finbra-purple">← Brokers</Link>
        <h1 className="text-2xl font-bold">Carga de colocación</h1>
        <p className="mt-1 max-w-3xl text-sm text-finbra-gray">
          Una fila por crédito fondeado. Se necesitan <strong>ID Broker</strong> (el código de Lendia), <strong>Fecha</strong> y <strong>Monto MXN</strong>;{" "}
          <strong>Comisión Apertura %</strong>, <strong>Pagado en su totalidad</strong> (Sí/No) y <strong>Referencia</strong> son opcionales. Las mismas
          columnas del Sheet &quot;Historial Colocacion&quot; sirven tal cual. Si subes dos veces el mismo archivo no se duplica: las operaciones ya guardadas
          se omiten. Nada se guarda hasta que confirmes.
        </p>
      </div>
      <ColocacionImportarPanel />
    </div>
  );
}
