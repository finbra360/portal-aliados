import type { ReactNode } from "react";
import { getAdminSession } from "@/lib/get-admin-session";
import { COBRANZA_ROLES, hasRole } from "@/lib/rbac";
import EmptyState from "@/components/ui/EmptyState";

// Cobranza muestra saldos y datos personales de deudores: solo finanzas y
// super_admin. Cada página vuelve a revisar el rol antes de leer datos,
// porque el layout y la página se ejecutan en paralelo.
export default async function CobranzaLayout({ children }: { children: ReactNode }) {
  const session = await getAdminSession();
  if (!hasRole(session, COBRANZA_ROLES)) {
    return (
      <EmptyState
        title="No tienes acceso a cobranza"
        description="Esta sección es solo para los roles de Finanzas y Super Admin. Si la necesitas, pídele a un Super Admin que cambie tu rol en Usuarios."
      />
    );
  }
  return <>{children}</>;
}
