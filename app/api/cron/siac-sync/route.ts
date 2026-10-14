import { NextRequest, NextResponse } from "next/server";
import { getSiacConfig } from "@/lib/siac/client";
import { runDailySync } from "@/lib/collections/sync";
import { notifySlack } from "@/lib/collections/notify";
import { runMoraReminders, type MoraRunResult } from "@/lib/db/whatsapp-mora";

// Una sola llamada a SIAC y, a las 9:00, hasta max_envios_mora_por_dia mensajes de WhatsApp (~0.75 s cada uno).
export const maxDuration = 120;
export const dynamic = "force-dynamic";

/**
 * Foto diaria de la cartera (una llamada a ListadoCobranzaJSON). La disparan
 * los crons de vercel.json con `Authorization: Bearer $CRON_SECRET`:
 *
 *   6:00 CDMX   /api/cron/siac-sync               foto de hoy
 *   9:00 CDMX   /api/cron/siac-sync?reintento=1   solo si la de las 6:00 no quedó completa,
 *                                                 y después los recordatorios de mora por WhatsApp
 *
 * Con el mismo secreto se puede correr a mano para otra fecha: ?fecha=2026-10-01
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET no está configurado" }, { status: 500 });
  }
  if (req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }
  if (!getSiacConfig()) {
    return NextResponse.json({ skipped: true, reason: "Faltan variables SIAC_*" }, { status: 503 });
  }

  const fecha = req.nextUrl.searchParams.get("fecha") ?? undefined;
  const reintento = req.nextUrl.searchParams.get("reintento") === "1";

  try {
    const result = await runDailySync({
      disparadoPor: fecha ? "manual" : reintento ? "cron_reintento" : "cron",
      fechaCorte: fecha,
      soloSiFalta: reintento,
    });
    // Los recordatorios salen después de la foto, dentro del horario de envío.
    // runMoraReminders no manda nada si hay un bloqueo (ambiente de pruebas,
    // envío apagado, sin foto de hoy…). Un error aquí no marca la foto como fallida.
    let whatsapp: MoraRunResult | { error: string } | null = null;
    if (reintento && result.status !== "error") {
      try {
        whatsapp = await runMoraReminders({ disparadoPor: "cron" });
        if (whatsapp.fallidos > 0 || whatsapp.detenido) {
          await notifySlack(
            `:warning: Recordatorios de mora: ${whatsapp.enviados} enviados, ${whatsapp.fallidos} fallidos.${whatsapp.detenido ? ` ${whatsapp.detenido}` : ""}`,
          );
        }
      } catch (e) {
        whatsapp = { error: (e as Error).message };
        await notifySlack(`:rotating_light: Los recordatorios de mora no pudieron correr: ${whatsapp.error}`);
      }
    }
    return NextResponse.json({ ...result, whatsapp }, { status: result.status === "error" ? 500 : 200 });
  } catch (e) {
    // Errores antes de poder registrar la corrida (base caída, fecha inválida).
    const mensaje = (e as Error).message;
    await notifySlack(`:rotating_light: La sincronización de cartera con SIAC no pudo arrancar: ${mensaje}`);
    return NextResponse.json({ error: mensaje }, { status: 500 });
  }
}
