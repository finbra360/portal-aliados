import type { ReactNode } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { verifySession, SESSION_COOKIE_NAME } from "@/lib/auth";
import { brokerSigueActivo } from "@/lib/db/brokers";
import { getBrokerContext } from "@/lib/broker-data";
import { getInsights } from "@/lib/insights";
import { anunciosParaBroker, type AnuncioParaBroker } from "@/lib/db/announcements";
import Nav from "./Nav";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  const session = token ? await verifySession(token) : null;

  let tier = null;
  let notifications: string[] = [];
  let anuncios: AnuncioParaBroker[] = [];

  if (session) {
    // Suspendido o dado de baja después de iniciar sesión: se le cierra el acceso ya.
    // Si la base falla no se saca a nadie (las páginas mostrarán su propio error).
    let activo = true;
    try {
      activo = await brokerSigueActivo(session.brokerId);
    } catch {
      activo = true;
    }
    if (!activo) redirect("/api/auth/sesion-invalida");

    try {
      anuncios = await anunciosParaBroker(session.brokerId);
    } catch {
      // Sin anuncios si falla: no tumba la página.
    }

    try {
      const ctx = await getBrokerContext(session.brokerId);
      tier = ctx.tier.actual;
      notifications = getInsights(ctx);
    } catch {
      // Nav still renders without tier/notifications if the backend call fails.
    }
  }

  return (
    <div className="min-h-screen">
      <a
        href="#contenido"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-finbra-purple focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-white"
      >
        Saltar al contenido
      </a>
      <Nav nombre={session?.nombre ?? ""} tier={tier} notifications={notifications} anuncios={anuncios} />
      <main id="contenido" tabIndex={-1} className="mx-auto max-w-6xl px-4 py-8 outline-none">{children}</main>
    </div>
  );
}
