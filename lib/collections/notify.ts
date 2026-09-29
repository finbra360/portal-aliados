/**
 * Aviso al canal de cobranza en Slack vía Incoming Webhook. Si no hay webhook
 * configurado, o Slack falla, solo se registra en el log: un aviso que no
 * llega nunca debe tumbar la sincronización.
 */
export async function notifySlack(texto: string): Promise<void> {
  const url = process.env.SLACK_COBRANZA_WEBHOOK_URL;
  if (!url) {
    console.warn("SLACK_COBRANZA_WEBHOOK_URL no está configurado; aviso no enviado:", texto);
    return;
  }
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: texto }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) console.error(`Slack respondió ${res.status} al aviso de cobranza`);
  } catch (e) {
    console.error("No se pudo mandar el aviso a Slack:", e);
  }
}
