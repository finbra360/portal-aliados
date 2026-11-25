import { getAdminSession } from "@/lib/get-admin-session";
import { puede } from "@/lib/permisos";
import { codigoDeError } from "@/lib/collections/errors";
import { getEmpresasPorRevisar } from "@/lib/db/juntar-empresas";
import Card from "@/components/ui/Card";
import EmptyState from "@/components/ui/EmptyState";
import RevisarEmpresas from "./RevisarEmpresas";

export default async function EmpresasPorRevisarPage() {
  const session = await getAdminSession();
  if (!puede(session, "clientes.configurar")) {
    return <EmptyState title="Solo Super Admin" description="Juntar empresas mueve negocios, contactos y tareas de una empresa a otra para todo el equipo." />;
  }
  let renglones: Awaited<ReturnType<typeof getEmpresasPorRevisar>>;
  try {
    renglones = await getEmpresasPorRevisar();
  } catch (e) {
    const c = codigoDeError("clientes: empresas por revisar", e);
    return <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-red-700">No pudimos cargar las empresas. <span className="text-sm opacity-70">(código {c})</span></div>;
  }
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Empresas por revisar</h1>
        <p className="mt-1 text-sm text-finbra-gray">
          Prospectos que se parecen por nombre a otra empresa, por ejemplo los que creó el importador de HubSpot cuando el nombre no era idéntico al de SIAC.
          Al juntar, sus negocios, contactos, actividad y tareas pasan a la empresa elegida, y el prospecto se borra. Queda en el Audit Log.
        </p>
      </div>
      <Card>
        <RevisarEmpresas renglones={renglones} />
      </Card>
    </div>
  );
}
