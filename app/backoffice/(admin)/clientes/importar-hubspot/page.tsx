import Link from "next/link";
import { getAdminSession } from "@/lib/get-admin-session";
import { puede } from "@/lib/permisos";
import EmptyState from "@/components/ui/EmptyState";
import ImportarHubspotPanel from "./ImportarHubspotPanel";

export default async function ImportarHubspotPage() {
  if (!puede(await getAdminSession(), "clientes.importar")) {
    return <EmptyState title="Solo Super Admin puede importar" description="Pídele a un Super Admin que haga la importación del historial de HubSpot." />;
  }
  return (
    <div className="space-y-6">
      <div>
        <Link href="/backoffice/clientes" className="text-sm text-finbra-purple hover:underline">← Clientes</Link>
        <h1 className="mt-2 text-2xl font-bold">Importar historial de HubSpot</h1>
        <div className="mt-2 max-w-3xl space-y-2 text-sm text-finbra-gray">
          <p>
            Trae los negocios ganados de HubSpot para conocer a los clientes que liquidaron antes de la sincronización con SIAC. Cada empresa se liga a la que ya
            existe en Clientes (por el número de cliente de SIAC que escribas, por su ID de HubSpot o por el nombre) o se crea como ex cliente.
          </p>
          <p>
            Columnas: Incluir, ID negocio HubSpot, Negocio, Fecha de cierre (AAAA-MM-DD), Monto, Etapa, Pipeline, Producto, Empresa, ID empresa HubSpot,
            Industria, Sitio web y Número de cliente SIAC. La columna «Empresa» es la que agrupa: corrígela antes de importar. Pon «No» en «Incluir» para
            dejar fuera un negocio.
          </p>
          <p>Primero revisa la vista previa; no se guarda nada hasta que le das «Importar». Volver a importar el mismo archivo no duplica nada.</p>
        </div>
      </div>
      <ImportarHubspotPanel />
    </div>
  );
}
