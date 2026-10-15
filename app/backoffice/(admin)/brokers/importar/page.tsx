import Link from "next/link";
import { getAdminSession } from "@/lib/get-admin-session";
import { requireRole } from "@/lib/rbac";
import ImportarPanel from "./ImportarPanel";
import { BROKERS_EDITAN } from "../roles";

export default async function ImportarBrokersPage() {
  requireRole(await getAdminSession(), BROKERS_EDITAN);
  return (
    <div className="space-y-6">
      <div>
        <Link href="/backoffice/brokers" className="text-sm text-finbra-gray hover:text-finbra-purple">← Brokers</Link>
        <h1 className="text-2xl font-bold">Carga masiva de brokers</h1>
        <p className="mt-1 max-w-3xl text-sm text-finbra-gray">
          La primera fila deben ser los encabezados. Se necesitan <strong>Email</strong> y <strong>Nombre</strong>; <strong>Teléfono</strong> e{" "}
          <strong>ID Broker</strong> son opcionales. El ID es el código de Lendia (por ejemplo FAPBR044) y se respeta tal cual; a quien no traiga ID se le asigna el siguiente B###.
          Primero se revisa y te mostramos qué va a pasar con cada fila; nada se guarda hasta que confirmes.
        </p>
      </div>
      <ImportarPanel />
    </div>
  );
}
