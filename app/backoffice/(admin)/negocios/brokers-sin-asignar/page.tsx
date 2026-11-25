import Link from "next/link";
import { getAdminSession } from "@/lib/get-admin-session";
import { puede } from "@/lib/permisos";
import { codigoDeError } from "@/lib/collections/errors";
import { getBrokersSinAsignar } from "@/lib/db/brokers-sin-asignar";
import Card from "@/components/ui/Card";
import EmptyState from "@/components/ui/EmptyState";
import AsignarBrokers from "./AsignarBrokers";

export default async function BrokersSinAsignarPage() {
  const session = await getAdminSession();
  if (!puede(session, "originacion.operar")) {
    return <EmptyState title="Sin acceso" description="Asignar brokers es para quien opera los negocios." />;
  }
  let datos: Awaited<ReturnType<typeof getBrokersSinAsignar>>;
  try {
    datos = await getBrokersSinAsignar();
  } catch (e) {
    const c = codigoDeError("originación: brokers sin asignar", e);
    return <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-red-700">No pudimos cargar los negocios. <span className="text-sm opacity-70">(código {c})</span></div>;
  }
  if (!datos) {
    return <EmptyState title="Falta preparar la base de datos" description="Corre lib/db/crm-schema.sql y después security.sql en Supabase para ligar negocios con brokers." />;
  }
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <Link href="/backoffice/negocios?filtro=brokers" className="text-sm text-finbra-purple hover:underline">← Negocios de brokers</Link>
        <h1 className="mt-1 text-2xl font-bold">Brokers sin asignar</h1>
        <p className="mt-1 text-sm text-finbra-gray">
          Negocios que llegaron de un broker sin decir de cuál; casi todos vienen de HubSpot, que no lo guarda. Cuando otro negocio de la misma empresa ya
          tiene broker, o el nombre se parece a un crédito de la colocación de un broker, aquí sale sugerido: revísalo y asígnalo. Lo que asignes ya lo ve ese
          broker en su portal.
        </p>
      </div>
      <Card>
        {datos.brokers.length === 0 ? (
          <p className="text-sm text-amber-800">No hay brokers dados de alta. Dalos de alta en Brokers.</p>
        ) : (
          <AsignarBrokers renglones={datos.renglones} brokers={datos.brokers} />
        )}
      </Card>
    </div>
  );
}
