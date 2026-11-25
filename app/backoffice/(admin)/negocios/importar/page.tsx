import Link from "next/link";
import { getAdminSession } from "@/lib/get-admin-session";
import { puede } from "@/lib/permisos";
import Card from "@/components/ui/Card";
import EmptyState from "@/components/ui/EmptyState";
import ImportarHubspot from "./ImportarHubspot";

export default async function ImportarHubspotPage() {
  const session = await getAdminSession();
  if (!puede(session, "originacion.importar")) {
    return <EmptyState title="Solo Super Admin" description="Importar de HubSpot crea empresas y negocios para todo el equipo." />;
  }
  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <Link href="/backoffice/negocios" className="text-sm text-finbra-purple hover:underline">← Negocios</Link>
        <h1 className="mt-2 text-2xl font-bold">Importar de HubSpot</h1>
        <p className="mt-1 text-sm text-finbra-gray">
          Trae los negocios de HubSpot: los abiertos y, si los marcas, también los cerrados (Seguimiento a futuro, Rechazados y Ganados) con su fecha de cierre.
          No se traen las notas ni las actividades, ni los teléfonos y correos de los contactos: esos se capturan en la ficha. De inicio se marcan solo los abiertos
          con actividad en los últimos 6 meses; tú decides cuáles entran.
        </p>
      </div>
      <Card>
        <ImportarHubspot />
      </Card>
    </div>
  );
}
