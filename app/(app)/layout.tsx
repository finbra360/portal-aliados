import type { ReactNode } from "react";
import { cookies } from "next/headers";
import { verifySession, SESSION_COOKIE_NAME } from "@/lib/auth";
import { getBrokerContext } from "@/lib/broker-data";
import { getInsights } from "@/lib/insights";
import Nav from "./Nav";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  const session = token ? await verifySession(token) : null;

  let tier = null;
  let notifications: string[] = [];

  if (session) {
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
      <Nav nombre={session?.nombre ?? ""} tier={tier} notifications={notifications} />
      <main className="mx-auto max-w-6xl px-4 py-8">{children}</main>
    </div>
  );
}
