import Link from "next/link";
import { getAdminSession } from "@/lib/get-admin-session";
import { puede } from "@/lib/permisos";
import { codigoDeError } from "@/lib/collections/errors";
import { getAjustesClientes } from "@/lib/db/ajustes-clientes";
import { listEjecutivos } from "@/lib/db/empresas";
import { CAMPOS, DEFAULTS, valoresDe } from "@/lib/clientes/ajustes";
import Card from "@/components/ui/Card";
import EmptyState from "@/components/ui/EmptyState";
import { FormAjustes, FormEjecutivoPorOmision } from "./FormAjustes";

export default async function AjustesClientesPage() {
  const session = await getAdminSession();
  if (!puede(session, "clientes.configurar")) {
    return <EmptyState title="Solo Super Admin" description="Los ajustes de Clientes cambian cómo se calcula la salud y qué tareas se crean solas para todo el equipo." />;
  }

  let ajustes: Awaited<ReturnType<typeof getAjustesClientes>>;
  let ejecutivos: Awaited<ReturnType<typeof listEjecutivos>>;
  try {
    [ajustes, ejecutivos] = await Promise.all([getAjustesClientes(), listEjecutivos()]);
  } catch (e) {
    const c = codigoDeError("clientes: ajustes", e);
    return <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-red-700">No pudimos cargar los ajustes. <span className="text-sm opacity-70">(código {c})</span></div>;
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Ajustes de Clientes</h1>
        <p className="mt-1 text-sm text-finbra-gray">
          Cambian para todo el equipo desde que se guardan, y cada cambio queda en el{" "}
          <Link href="/backoffice/audit-log" className="text-finbra-purple hover:underline">
            Audit Log
          </Link>
          .
        </p>
      </div>

      <Card className="space-y-3">
        <div>
          <h2 className="text-lg font-bold">Ejecutivo por omisión</h2>
          <p className="text-sm text-finbra-gray">Queda como ejecutivo de cada empresa nueva que llega de SIAC. Las que ya existen no cambian.</p>
        </div>
        <FormEjecutivoPorOmision actual={ajustes.ejecutivoPorOmision} ejecutivos={ejecutivos} />
      </Card>

      <Card className="space-y-4">
        <div>
          <h2 className="text-lg font-bold">Salud del cliente</h2>
          <p className="text-sm text-finbra-gray">Cada cliente con crédito vigente parte de 100 puntos y pierde lo que resta cada señal.</p>
        </div>
        <FormAjustes clave="salud" campos={CAMPOS.salud} valores={ajustes.salud} omision={valoresDe("salud", DEFAULTS.salud)} />
      </Card>

      <Card className="space-y-4">
        <div>
          <h2 className="text-lg font-bold">Playbooks</h2>
          <p className="text-sm text-finbra-gray">Tareas que se crean solas después de la foto diaria de SIAC. Apagar uno no borra las tareas que ya creó.</p>
        </div>
        <FormAjustes clave="playbooks" campos={CAMPOS.playbooks} valores={ajustes.playbooks} omision={valoresDe("playbooks", DEFAULTS.playbooks)} />
      </Card>
    </div>
  );
}
