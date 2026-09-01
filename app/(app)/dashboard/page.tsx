import { cookies } from "next/headers";
import { verifySession, SESSION_COOKIE_NAME } from "@/lib/auth";
import { getStats } from "@/lib/n8n";
import DashboardChart from "./DashboardChart";

const formatCurrency = (value: number) =>
  new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN", maximumFractionDigits: 0 }).format(value);

export default async function DashboardPage() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  const session = token ? await verifySession(token) : null;

  if (!session) {
    return null;
  }

  let stats: Awaited<ReturnType<typeof getStats>> | null = null;
  let loadError = false;
  try {
    stats = await getStats(session.brokerId);
  } catch {
    loadError = true;
  }

  const mesActual = stats?.porMes.at(-1);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Hola, {session.nombre}</h1>

      {loadError ? (
        <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-red-700">
          No pudimos cargar tus datos en este momento. Intenta de nuevo más tarde.
        </div>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-xl border border-finbra-purple/10 bg-white p-6 shadow-[0_2px_12px_rgba(93,91,219,0.12)]">
              <p className="text-sm text-finbra-gray">Total histórico colocado</p>
              <p className="mt-1 text-3xl font-bold text-finbra-purple">
                {formatCurrency(stats?.totalHistorico ?? 0)}
              </p>
              <p className="mt-2 text-xs text-finbra-gray">{stats?.creditosCount ?? 0} créditos colocados</p>
            </div>
            <div className="rounded-xl border border-finbra-purple/10 bg-white p-6 shadow-[0_2px_12px_rgba(93,91,219,0.12)]">
              <p className="text-sm text-finbra-gray">Colocado este mes</p>
              <p className="mt-1 text-3xl font-bold text-finbra-purple">{formatCurrency(mesActual?.monto ?? 0)}</p>
              <p className="mt-2 text-xs text-finbra-gray">{mesActual?.mes ?? "—"}</p>
            </div>
          </div>

          <div className="rounded-xl border border-finbra-purple/10 bg-white p-6 shadow-[0_2px_12px_rgba(93,91,219,0.12)]">
            <p className="mb-4 text-sm font-medium text-finbra-gray">Colocación mes a mes</p>
            <DashboardChart data={stats?.porMes ?? []} />
          </div>
        </>
      )}
    </div>
  );
}
