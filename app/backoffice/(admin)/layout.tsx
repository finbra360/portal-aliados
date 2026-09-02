import type { ReactNode } from "react";
import { getAdminSession } from "@/lib/get-admin-session";
import BackofficeNav from "./BackofficeNav";

export default async function BackofficeLayout({ children }: { children: ReactNode }) {
  const session = await getAdminSession();

  if (!session) {
    return null;
  }

  return (
    <div className="flex min-h-screen bg-[#f7f7fb]">
      <BackofficeNav nombre={session.nombre} role={session.role} />
      <main className="flex-1 overflow-x-auto px-8 py-6">{children}</main>
    </div>
  );
}
