import { cache } from "react";
import { getStats, getLeaderboard, type BrokerStats, type LeaderboardResponse, type PorMes } from "./n8n";
import { getTierProgress, type TierProgress } from "./tiers";
import { getCurrentStreak, getPeriodDelta } from "./streaks";

export interface BrokerContext {
  stats: BrokerStats;
  leaderboard: LeaderboardResponse;
  tier: TierProgress;
  streak: number;
  position: number | null;
  totalBrokers: number;
  mesActual: PorMes | undefined;
  mesAnterior: PorMes | undefined;
  deltaMesPct: number | null;
}

/**
 * Wrapped in React's cache() so the layout and the page for a given request
 * only trigger one round of webhook calls, even though both need this data.
 */
export const getBrokerContext = cache(async (brokerId: string): Promise<BrokerContext> => {
  const [stats, leaderboard] = await Promise.all([getStats(brokerId), getLeaderboard()]);

  const tier = getTierProgress(stats.totalHistorico);
  const streak = getCurrentStreak(stats.porMes);
  const mesActual = stats.porMes.at(-1);
  const mesAnterior = stats.porMes.at(-2);
  const deltaMesPct = mesActual && mesAnterior ? getPeriodDelta(mesActual.monto, mesAnterior.monto) : null;
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
