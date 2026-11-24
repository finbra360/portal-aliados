import Link from "next/link";
import { getAdminSession } from "@/lib/get-admin-session";
import { puede } from "@/lib/permisos";
import { codigoDeError } from "@/lib/collections/errors";
import { empresasParaNegocio, hayNegocios } from "@/lib/db/negocios";
import { listEjecutivos } from "@/lib/db/empresas";
import Card from "@/components/ui/Card";
import EmptyState from "@/components/ui/EmptyState";
import NuevoNegocio from "./NuevoNegocio";

export default async function NuevoNegocioPage({ searchParams }: { searchParams: Promise<{ empresa?: string }> }) {
  const session = await getAdminSession();
  if (!puede(session, "originacion.operar")) {
    return <EmptyState title="No puedes dar de alta negocios" description="Tu rol puede consultar los negocios, pero no crearlos." />;
  }
  const { empresa } = await searchParams;

  let empresas: Awaited<ReturnType<typeof empresasParaNegocio>>;
  let ejecutivos: Awaited<ReturnType<typeof listEjecutivos>>;
  try {
    if (!(await hayNegocios())) {
      return <EmptyState title="Falta preparar la base de datos" description="Corre lib/db/crm-schema.sql y después security.sql en Supabase para activar los negocios de crédito." />;
    }
    [empresas, ejecutivos] = await Promise.all([empresasParaNegocio(), listEjecutivos()]);
  } catch (e) {
    const c = codigoDeError("originación: nuevo negocio", e);
    return <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-red-700">No pudimos cargar el formulario. <span className="text-sm opacity-70">(código {c})</span></div>;
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <Link href="/backoffice/negocios" className="text-sm text-finbra-purple hover:underline">← Negocios</Link>
        <h1 className="mt-2 text-2xl font-bold">Nuevo negocio</h1>
        <p className="mt-1 text-sm text-finbra-gray">Una solicitud de crédito de una empresa. Si la empresa todavía no es cliente, se da de alta como prospecto.</p>
      </div>
      <Card>
        <NuevoNegocio empresas={empresas} ejecutivos={ejecutivos} yo={session.email} empresaInicial={empresas.some((e) => e.id === empresa) ? empresa! : null} />
      </Card>
    </div>
  );
}
