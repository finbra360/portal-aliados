import Link from "next/link";
import { cookies } from "next/headers";
import { verifySession, SESSION_COOKIE_NAME } from "@/lib/auth";
import { getBrokerContext } from "@/lib/broker-data";
import { formatCurrency } from "@/lib/format";
import Card from "@/components/ui/Card";
import StatCard from "@/components/ui/StatCard";
import EmptyState from "@/components/ui/EmptyState";
import ProgressBar from "@/components/ui/ProgressBar";
import { IconTrendingUp, IconWallet, IconListChecks, IconTrophy, IconFlame, IconCoins } from "@/components/ui/icons";
import DashboardChart from "./DashboardChart";

export default async function DashboardPage() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  const session = token ? await verifySession(token) : null;

  if (!session) {
    return null;
  }

  let ctx: Awaited<ReturnType<typeof getBrokerContext>> | null = null;
  let loadError = false;
  try {
    ctx = await getBrokerContext(session.brokerId);
  } catch {
    loadError = true;
  }

  if (loadError || !ctx) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-red-700">
        No pudimos cargar tus datos en este momento. Intenta de nuevo más tarde.
      </div>
    );
  }

  const { stats, tier, streak, position, totalBrokers, mesActual, deltaMesPct } = ctx;
  const ticketPromedio = stats.creditosCount > 0 ? stats.totalHistorico / stats.creditosCount : 0;
  const brokerArriba = position && position > 1 ? ctx.leaderboard.ranking[position - 2] : null;
  const faltaParaSubir = brokerArriba ? brokerArriba.totalColocado - stats.totalHistorico : 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-bold">Hola, {session.nombre}</h1>
        <span
          className="rounded-full px-3 py-1 text-xs font-semibold text-white"
          style={{ backgroundColor: tier.actual.color }}
        >
          Nivel {tier.actual.nombre}
        </span>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Colocado este mes"
          value={formatCurrency(mesActual?.monto ?? 0)}
          sublabel={mesActual?.mes ?? "—"}
          deltaPct={deltaMesPct}
          icon={<IconTrendingUp />}
        />
        <StatCard
          label="Total histórico colocado"
          value={formatCurrency(stats.totalHistorico)}
          icon={<IconWallet />}
        />
        <StatCard label="Créditos colocados" value={String(stats.creditosCount)} icon={<IconListChecks />} />
        <StatCard label="Ticket promedio" value={formatCurrency(ticketPromedio)} icon={<IconCoins />} />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <div className="flex items-center gap-2 text-finbra-purple/60">
            <IconTrophy />
            <p className="text-sm text-finbra-gray">Posición en ranking</p>
          </div>
          <p className="mt-1 text-3xl font-bold text-finbra-purple">
            {position ? `#${position}` : "—"}
            {totalBrokers > 0 && <span className="ml-1 text-sm font-normal text-finbra-gray">de {totalBrokers}</span>}
          </p>
          <p className="mt-2 text-xs text-finbra-gray">
            {brokerArriba
              ? `Te faltan ${formatCurrency(faltaParaSubir)} para el puesto #${position! - 1}`
              : position === 1
                ? "¡Vas en el primer lugar!"
                : "Coloca tu primer crédito para entrar al ranking"}
          </p>
        </Card>

        <Card>
          <div className="flex items-center gap-2 text-finbra-purple/60">
            <IconFlame />
            <p className="text-sm text-finbra-gray">Racha activa</p>
          </div>
          <p className="mt-1 text-3xl font-bold text-finbra-purple">{streak}</p>
          <p className="mt-2 text-xs text-finbra-gray">
            {streak > 0 ? "meses seguidos colocando" : "coloca este mes para iniciar tu racha"}
          </p>
        </Card>

        <Card className="sm:col-span-2">
          <p className="text-sm text-finbra-gray">Progreso de nivel</p>
          <div className="mt-2 flex items-center justify-between text-xs text-finbra-gray">
            <span className="font-semibold text-finbra-purple">{tier.actual.nombre}</span>
            <span>{tier.siguiente ? tier.siguiente.nombre : "Nivel máximo"}</span>
          </div>
          <div className="mt-1">
            <ProgressBar percent={tier.progresoPct} color={tier.actual.color} />
          </div>
          <p className="mt-2 text-xs text-finbra-gray">
            {tier.siguiente
              ? `Te faltan ${formatCurrency(tier.faltante)} para llegar a ${tier.siguiente.nombre}`
              : "Estás en el nivel más alto"}
          </p>
        </Card>
      </div>

      <EmptyState
        title="Comisiones aún no conectadas"
        description="Cuando tu comisión esté disponible en el sistema, la verás aquí. Mientras tanto revisa la sección Comisiones para más detalle."
        action={
          <Link href="/comisiones" className="text-sm font-semibold text-finbra-purple hover:underline">
            Ir a Comisiones →
          </Link>
        }
      />

      <Card>
        <p className="mb-4 text-sm font-medium text-finbra-gray">Colocación en el tiempo</p>
        <DashboardChart data={stats.porMes} />
      </Card>
    </div>
  );
}
