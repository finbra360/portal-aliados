import { createHmac, timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { procesarWebhook } from "@/lib/db/whatsapp-chat";
import { codigoDeError } from "@/lib/collections/errors";

export const dynamic = "force-dynamic";

/**
 * Webhook de la Cloud API de WhatsApp (app "Finbra Cobranza" en Meta):
 * mensajes de clientes y estados de los mensajes enviados.
 *
 * GET  verificación al registrar la URL en Meta (hub.verify_token = WHATSAPP_VERIFY_TOKEN).
 * POST eventos, firmados por Meta con la clave secreta de la app (WHATSAPP_APP_SECRET)
 *      en X-Hub-Signature-256. Sin firma válida no se procesa nada.
 */
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const esperado = process.env.WHATSAPP_VERIFY_TOKEN;
  if (esperado && q.get("hub.mode") === "subscribe" && q.get("hub.verify_token") === esperado) {
    return new NextResponse(q.get("hub.challenge") ?? "", { status: 200, headers: { "Content-Type": "text/plain" } });
  }
  return NextResponse.json({ error: "No autorizado" }, { status: 403 });
}

function firmaValida(cuerpo: string, firma: string | null, secreto: string): boolean {
  if (!firma?.startsWith("sha256=")) return false;
  const esperada = Buffer.from(createHmac("sha256", secreto).update(cuerpo, "utf8").digest("hex"), "utf8");
  const recibida = Buffer.from(firma.slice("sha256=".length), "utf8");
  return esperada.length === recibida.length && timingSafeEqual(esperada, recibida);
}

export async function POST(req: NextRequest) {
  const secreto = process.env.WHATSAPP_APP_SECRET;
  if (!secreto) return NextResponse.json({ error: "WHATSAPP_APP_SECRET no está configurado" }, { status: 503 });
  const cuerpo = await req.text();
  if (!firmaValida(cuerpo, req.headers.get("x-hub-signature-256"), secreto)) {
    return NextResponse.json({ error: "Firma inválida" }, { status: 401 });
  }
  let json: unknown;
  try {
    json = JSON.parse(cuerpo);
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }
  try {
    const r = await procesarWebhook(json);
    return NextResponse.json({ ok: true, ...r });
  } catch (e) {
    // 500 para que Meta lo reintente; los duplicados se descartan por wamid.
    const c = codigoDeError("webhook whatsapp", e);
    return NextResponse.json({ error: c }, { status: 500 });
  }
}
