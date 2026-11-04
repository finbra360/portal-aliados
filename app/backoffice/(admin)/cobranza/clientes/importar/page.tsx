import Link from "next/link";
import { getAdminSession } from "@/lib/get-admin-session";
import { COBRANZA_ROLES, hasRole } from "@/lib/rbac";
import ContactosImportarPanel from "./ContactosImportarPanel";

export default async function ImportarContactosPage() {
  if (!hasRole(await getAdminSession(), COBRANZA_ROLES)) return null;
  return (
    <div className="space-y-6">
      <div>
        <Link href="/backoffice/cobranza/clientes" className="text-sm text-finbra-purple hover:underline">← Clientes</Link>
        <h1 className="text-2xl font-bold">Carga masiva de contactos</h1>
        <div className="mt-1 max-w-3xl space-y-2 text-sm text-finbra-gray">
          <p>
            Para dar de alta muchos contactos a la vez, en lugar de uno por uno en el perfil de cada cliente. La primera fila deben ser los encabezados. Cada contacto necesita su{" "}
            <strong>cliente</strong> (columna <strong>Número de cliente</strong>, <strong>Crédito</strong> o <strong>Cliente</strong> con la razón social como está en SIAC) y su{" "}
            <strong>Teléfono</strong> o <strong>Correo</strong> (si trae los dos, se dan de alta los dos).
          </p>
          <p>
            Opcionales: <strong>Nombre</strong> de la persona; <strong>Tipo</strong> (Dueño, Pagos, Contabilidad, Otro, Aval o Referencia; vacío = del deudor sin clasificar);{" "}
            <strong>Recordatorios</strong> (Sí para que a ese teléfono le lleguen los recordatorios de cobranza; uno por cliente y nunca a un aval o referencia) y <strong>Notas</strong>.
          </p>
          <p>Primero se revisa y te mostramos qué va a pasar con cada fila; nada se guarda hasta que confirmes. Los contactos que ya existen se omiten.</p>
        </div>
      </div>
      <ContactosImportarPanel />
    </div>
  );
}
