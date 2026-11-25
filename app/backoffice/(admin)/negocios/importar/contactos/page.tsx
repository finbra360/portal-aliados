import Link from "next/link";
import { getAdminSession } from "@/lib/get-admin-session";
import { puede } from "@/lib/permisos";
import Card from "@/components/ui/Card";
import EmptyState from "@/components/ui/EmptyState";
import ImportarContactos from "../ImportarContactos";
import PestanasImportar from "../PestanasImportar";

export default async function ImportarContactosPage() {
  const session = await getAdminSession();
  if (!puede(session, "originacion.importar")) {
    return <EmptyState title="Solo Super Admin" description="Importar de HubSpot crea contactos para todo el equipo." />;
  }
  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <Link href="/backoffice/negocios" className="text-sm text-finbra-purple hover:underline">← Negocios</Link>
        <h1 className="mt-2 text-2xl font-bold">Importar de HubSpot</h1>
        <p className="mt-1 text-sm text-finbra-gray">
          Trae los contactos de HubSpot (nombre, puesto, teléfonos y correo) a sus empresas de Clientes. Cada contacto va a la empresa con el mismo nombre que su
          empresa en HubSpot; los que ya están (mismo nombre, teléfono o correo) no se repiten. Conviene importar primero los negocios y juntar las empresas
          duplicadas.
        </p>
      </div>
      <PestanasImportar actual="contactos" />
      <Card>
        <ImportarContactos />
      </Card>
    </div>
  );
}
