import type { ReactNode } from "react";
import { getAdminSession } from "@/lib/get-admin-session";
import { hasRole } from "@/lib/rbac";
import { CH_VEN } from "@/lib/credit-health/roles";
import { creditHealthConfigurado } from "@/lib/credit-health/db";
import EmptyState from "@/components/ui/EmptyState";

// Prospectos del diagnóstico público Credit Health. Cada página y acción vuelve a
// revisar el rol, porque el layout y la página se ejecutan en paralelo.
export default async function CreditHealthLayout({ children }: { children: ReactNode }) {
  const session = await getAdminSession();
  if (!hasRole(session, CH_VEN)) {
    return <EmptyState title="No tienes acceso a Credit Health" description="Pídele a un Super Admin que revise tu rol en Usuarios." />;
  }
  if (!creditHealthConfigurado()) {
    return (
      <EmptyState
        title="Credit Health todavía no está conectado"
        description="Falta configurar CREDIT_HEALTH_DATABASE_URL en este ambiente para leer los prospectos del diagnóstico."
      />
    );
  }
  return <>{children}</>;
}
