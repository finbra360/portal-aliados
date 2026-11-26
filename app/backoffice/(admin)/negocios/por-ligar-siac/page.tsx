import Link from "next/link";
import { getAdminSession } from "@/lib/get-admin-session";
import { puede } from "@/lib/permisos";
import { codigoDeError } from "@/lib/collections/errors";
import { getPorLigarSiac } from "@/lib/db/por-ligar-siac";
import Card from "@/components/ui/Card";
import EmptyState from "@/components/ui/EmptyState";
import LigarEnLote from "./LigarEnLote";

export default async function PorLigarSiacPage() {
  const session = await getAdminSession();
  if (!puede(session, "originacion.operar")) {
    return <EmptyState title="Sin acceso" description="Ligar negocios con SIAC es para quien opera los negocios." />;
  }
  let datos: Awaited<ReturnType<typeof getPorLigarSiac>>;
  try {
    datos = await getPorLigarSiac();
  } catch (e) {
    const c = codigoDeError("originación: por ligar con SIAC", e);
    return <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-red-700">No pudimos cargar los negocios. <span className="text-sm opacity-70">(código {c})</span></div>;
  }
  if (!datos) {
    return <EmptyState title="Falta preparar la base de datos" description="Corre lib/db/crm-schema.sql y después security.sql en Supabase para ligar negocios con SIAC." />;
  }
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <Link href="/backoffice/negocios?vista=lista&etapa=dispersado" className="text-sm text-finbra-purple hover:underline">← Negocios dispersados</Link>
        <h1 className="mt-1 text-2xl font-bold">Por ligar con SIAC</h1>
        <p className="mt-1 text-sm text-finbra-gray">
          Negocios dispersados que todavía no tienen su crédito de SIAC, con los créditos que se le parecen por nombre, monto y fecha de ministración. Los
          «seguros» tienen una sugerencia clara y se pueden ligar todos de una vez; los demás, elige el crédito en cada uno. Al ligar, si SIAC le había
          creado otra empresa al cliente, se junta con la del negocio. Si un negocio no tiene crédito en SIAC (por ejemplo, uno viejo de HubSpot), márcalo
          y deja de pedirse.
        </p>
      </div>
      <Card>
        <LigarEnLote renglones={datos.renglones} seguras={datos.seguras} />
      </Card>
    </div>
  );
}
