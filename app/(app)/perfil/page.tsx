import { cookies } from "next/headers";
import { verifySession, SESSION_COOKIE_NAME } from "@/lib/auth";
import { getBrokerContext } from "@/lib/broker-data";
import { formatCurrency } from "@/lib/format";
import Card from "@/components/ui/Card";

export default async function PerfilPage() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  const session = token ? await verifySession(token) : null;

  if (!session) {
    return null;
  }

  let tierNombre = "—";
  let tierColor = "#5d5bdb";
  let totalHistorico: number | null = null;
  try {
    const ctx = await getBrokerContext(session.brokerId);
    tierNombre = ctx.tier.actual.nombre;
    tierColor = ctx.tier.actual.color;
    totalHistorico = ctx.stats.totalHistorico;
  } catch {
    // Profile still renders with session data even if the stats call fails.
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Mi perfil</h1>

      <Card className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-lg font-bold">{session.nombre}</p>
          <p className="text-sm text-finbra-gray">{session.email}</p>
          <p className="text-sm text-finbra-gray">ID Broker: {session.brokerId}</p>
        </div>
        <span className="w-fit rounded-full px-4 py-1.5 text-sm font-semibold text-white" style={{ backgroundColor: tierColor }}>
          Nivel {tierNombre}
        </span>
      </Card>

      {totalHistorico !== null && (
        <Card>
          <p className="text-sm text-finbra-gray">Total histórico colocado con Finbra</p>
          <p className="mt-1 text-2xl font-bold text-finbra-purple">{formatCurrency(totalHistorico)}</p>
        </Card>
      )}
    </div>
  );
}
