import type { ReactNode } from "react";
import { getAdminSession } from "@/lib/get-admin-session";
import BackofficeNav from "./BackofficeNav";

export default async function BackofficeLayout({ children }: { children: ReactNode }) {
  const session = await getAdminSession();

  if (!session) {
    return null;
  }

  return (
    <div className="flex min-h-screen flex-col bg-[#f7f7fb] lg:flex-row">
      <BackofficeNav nombre={session.nombre} role={session.role} />
      {/* relative: los textos sr-only (absolutos) de tablas anchas se quedan dentro del
          recorte de main y no ensanchan la página en el celular. */}
      <main className="relative min-w-0 flex-1 overflow-x-auto px-4 py-5 lg:px-8 lg:py-6">{children}</main>
    </div>
  );
}
