import Link from "next/link";
import { getAdminSession } from "@/lib/get-admin-session";
import { COBRANZA_ROLES, hasRole } from "@/lib/rbac";
import { listCuentas } from "@/lib/db/payment-accounts";
import { codigoDeError } from "@/lib/collections/errors";
import Card from "@/components/ui/Card";
import CuentasPanel from "./CuentasPanel";

export default async function CuentasPagoPage() {
  if (!hasRole(await getAdminSession(), COBRANZA_ROLES)) return null;

  let data: Awaited<ReturnType<typeof listCuentas>>;
  try {
    data = await listCuentas();
  } catch (e) {
    const c = codigoDeError("cuentas de pago", e);
    return <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-red-700">No pudimos cargar las cuentas de pago. <span className="text-sm opacity-70">(código {c})</span></div>;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Cuentas de pago</h1>
        <p className="mt-1 text-sm text-finbra-gray">
          Cuentas de Finbra a las que transfieren los clientes. Cada cliente paga a una; se elige en su perfil y va en sus recordatorios.
        </p>
      </div>

      {data.clientesSinCuenta > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          {data.clientesSinCuenta === 1 ? "1 cliente activo no tiene" : `${data.clientesSinCuenta} clientes activos no tienen`} cuenta de pago y no recibirán
          recordatorios. Asígnales una desde aquí o desde su perfil en{" "}
          <Link href="/backoffice/cobranza/clientes?filtro=sin_cuenta" className="font-medium underline">Clientes</Link>.
        </div>
      )}

      <Card>
        <CuentasPanel cuentas={data.cuentas} clientesSinCuenta={data.clientesSinCuenta} />
      </Card>
    </div>
  );
}
