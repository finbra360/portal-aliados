// Resumen semanal de originación (lib/clientes/resumen-semanal.ts): junta los
// números de la semana pasada y lo manda al canal de onboarding de Slack con
// SLACK_ONBOARDING_WEBHOOK_URL. Sale los lunes con la corrida de las 9:00
// (app/api/cron/siac-sync) y una sola vez por semana (crm_settings
// «resumen_semanal»); desde Negocios → Métricas se puede ver y mandar a mano.

import { sql } from "@/lib/db";
import { logAudit } from "@/lib/db/audit";
import { ambienteActual } from "@/lib/db/collections";
import { fechaMexico } from "@/lib/collections/rules";
import { datosEmbudo } from "@/lib/db/embudo";
import { getAjustesPlaybooks } from "@/lib/db/playbooks";
import { dispersadosSinLigar } from "@/lib/db/siac-liga";
import { operacionesSonNegocios } from "@/lib/db/operations";
import { calcularEmbudo } from "@/lib/clientes/embudo";
import { armarResumen, movimientosDeLaSemana, semanaAnterior, type Semana } from "@/lib/clientes/resumen-semanal";

const URL_BACKOFFICE = "https://backoffice.finbra.com";
const CLAVE = "resumen_semanal";

export const slackOnboardingConfigurado = () => Boolean(process.env.SLACK_ONBOARDING_WEBHOOK_URL);

/** El texto del resumen de la semana anterior a `hoy` (por omisión, hoy en México). */
export async function getResumenSemanal(hoy = fechaMexico()): Promise<{ semana: Semana; texto: string }> {
  const [{ negocios, cambios }, ajustes, conBrokers, sinLigar] = await Promise.all([
    datosEmbudo(),
    getAjustesPlaybooks(),
    operacionesSonNegocios(),
    dispersadosSinLigar(),
  ]);
  const semana = semanaAnterior(hoy);
  const previa = semanaAnterior(semana.desde);
  const base = { negocios, cambios, hoy, diasAtorado: ajustes.estancadoDias };
  const actual = calcularEmbudo({ ...base, desde: semana.desdeIso, hasta: semana.hastaIso });
  const anterior = calcularEmbudo({ ...base, desde: previa.desdeIso, hasta: previa.hastaIso });
  let brokersSinAsignar = 0;
  if (conBrokers) {
    const [r] = await sql`
      SELECT count(*)::int AS n FROM crm_negocios_credito WHERE ambiente = ${ambienteActual()} AND origen = 'broker' AND broker_id IS NULL
    `;
    brokersSinAsignar = r.n as number;
  }
  const { avances, dispersados } = movimientosDeLaSemana(negocios, cambios, semana);
  const texto = armarResumen({
    semana,
    urlBase: URL_BACKOFFICE,
    actual,
    anterior,
    avances,
    dispersados,
    diasAtorado: ajustes.estancadoDias,
    brokersSinAsignar,
    sinLigar,
  });
  return { semana, texto };
}

export type EnvioResumen = { enviado: true; semana: string } | { enviado: false; motivo: string };

/**
 * Manda el resumen a Slack. Sin `forzar`, una vez por semana (si ya salió la
 * de esa semana, no vuelve a salir aunque el cron corra otra vez).
 */
export async function enviarResumenSemanal(p: { forzar?: boolean; actor: string }): Promise<EnvioResumen> {
  const url = process.env.SLACK_ONBOARDING_WEBHOOK_URL;
  if (!url) return { enviado: false, motivo: "Falta SLACK_ONBOARDING_WEBHOOK_URL en Vercel." };
  const { semana, texto } = await getResumenSemanal();
  const [ultimo] = await sql`SELECT value FROM crm_settings WHERE key = ${CLAVE}`;
  if (!p.forzar && (ultimo?.value as { semana?: string } | undefined)?.semana === semana.desde) {
    return { enviado: false, motivo: `El resumen de la semana del ${semana.desde} ya se mandó.` };
  }
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: texto }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`Slack respondió ${res.status}`);
  await sql`
    INSERT INTO crm_settings (key, value, descripcion, updated_by, updated_at)
    VALUES (${CLAVE}, ${JSON.stringify({ semana: semana.desde })}::text::jsonb, 'Última semana (lunes) cuyo resumen de originación se mandó a Slack.', ${p.actor}, now())
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()
  `;
  if (p.actor !== "cron") await logAudit({ actorEmail: p.actor, action: "resumen_semanal_slack", entityType: "crm_settings", entityId: CLAVE, metadata: { semana: semana.desde } });
  return { enviado: true, semana: semana.desde };
}
