import type { BrokerContext } from "./broker-data";
import { formatCurrency, formatPercent } from "./format";

/**
 * All insights here are derived purely from real data already returned by
 * the stats/leaderboard webhooks — nothing fabricated or hardcoded per broker.
 */
export function getInsights(ctx: BrokerContext): string[] {
  const insights: string[] = [];

  if (ctx.streak >= 2) {
    insights.push(`Llevas ${ctx.streak} meses seguidos colocando con Finbra.`);
  }

  if (ctx.totalBrokers > 1 && ctx.position) {
    if (ctx.position === 1) {
      insights.push("Vas en el primer lugar del ranking de brokers.");
    } else {
      const above = ctx.leaderboard.ranking[ctx.position - 2];
      const falta = above ? above.totalColocado - ctx.stats.totalHistorico : 0;
      if (above && falta > 0) {
        insights.push(`Estás a ${formatCurrency(falta)} de subir al puesto #${ctx.position - 1}.`);
      }
    }
  }

  if (ctx.tier.siguiente) {
    insights.push(`Te faltan ${formatCurrency(ctx.tier.faltante)} para el nivel ${ctx.tier.siguiente.nombre}.`);
  }

  if (ctx.deltaMesPct !== null && ctx.deltaMesPct > 0) {
    insights.push(`Tu colocación de este mes subió ${formatPercent(ctx.deltaMesPct)} vs. el mes pasado.`);
  }

  return insights;
}
