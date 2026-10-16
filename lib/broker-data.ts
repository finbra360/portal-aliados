import { cache } from "react";
import { getLeaderboard, getStats } from "@/lib/db/colocacion";
import { fechaMexico } from "@/lib/collections/rules";
import { type BrokerStats, type LeaderboardResponse, type PorMes } from "./n8n";
import { getTierProgress, type TierProgress } from "./tiers";
import { getCurrentStreak, getPeriodDelta, mesesDeCalendario } from "./streaks";

export interface BrokerContext {
  stats: BrokerStats;
  leaderboard: LeaderboardResponse;
  tier: TierProgress;
  streak: number;
  position: number | null;
  totalBrokers: number;
  /** Mes en curso del calendario (monto 0 si todavía no coloca en él). */
  mesActual: PorMes;
  mesAnterior: PorMes;
  /** null si todavía no coloca este mes o el mes pasado no tuvo nada. */
  deltaMesPct: number | null;
}

/**
 * Wrapped in React's cache() so the layout and the page for a given request
 * only trigger one round of queries, even though both need this data.
 */
export const getBrokerContext = cache(async (brokerId: string): Promise<BrokerContext> => {
  const [stats, leaderboard] = await Promise.all([getStats(brokerId), getLeaderboard()]);

  const hoy = fechaMexico();
  const tier = getTierProgress(stats.totalHistorico);
  const streak = getCurrentStreak(stats.porMes, hoy);
  const { actual: mesActual, anterior: mesAnterior } = mesesDeCalendario(stats.porMes, hoy);
  // Al inicio del mes, "0 contra el mes pasado" asusta sin decir nada: solo se compara cuando ya hay colocación.
  const deltaMesPct = mesActual.monto > 0 ? getPeriodDelta(mesActual.monto, mesAnterior.monto) : null;
  const idx = leaderboard.ranking.findIndex((r) => r.brokerId === brokerId);

  return {
    stats,
    leaderboard,
    tier,
    streak,
    position: idx >= 0 ? idx + 1 : null,
    totalBrokers: leaderboard.ranking.length,
    mesActual,
    mesAnterior,
    deltaMesPct,
  };
});
