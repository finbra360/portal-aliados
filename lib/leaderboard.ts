import { getLeaderboard as leaderboardDeN8n, type LeaderboardResponse } from "@/lib/n8n";
import { nombresDeBrokers } from "@/lib/db/brokers";

/**
 * Ranking de colocación (n8n, desde el Sheet "Historial Colocacion") con los
 * nombres de la tabla brokers. Si la base falla, se quedan los de n8n.
 */
export async function getLeaderboard(): Promise<LeaderboardResponse> {
  const [lb, nombres] = await Promise.all([leaderboardDeN8n(), nombresDeBrokers().catch(() => null)]);
  if (!nombres) return lb;
  return { ...lb, ranking: lb.ranking.map((r) => ({ ...r, nombre: nombres.get(r.brokerId) ?? r.nombre })) };
}
