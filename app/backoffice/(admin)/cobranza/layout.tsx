import type { ReactNode } from "react";
import { getAdminSession } from "@/lib/get-admin-session";
import { puede } from "@/lib/permisos";
import EmptyState from "@/components/ui/EmptyState";

// Cobranza muestra saldos y datos personales de deudores: solo los roles con
// «cartera.ver» (lib/permisos.ts). Cada página vuelve a revisar el permiso
// antes de leer datos, porque el layout y la página se ejecutan en paralelo.
export default async function CobranzaLayout({ children }: { children: ReactNode }) {
  const session = await getAdminSession();
  if (!puede(session, "cartera.ver")) {
    return (
      <EmptyState
        title="No tienes acceso a cobranza"
        description="Tu rol no puede ver la cartera. Si la necesitas, pídele a un Super Admin que cambie tu rol en Usuarios."
      />
    );
  }
  return <>{children}</>;
}
