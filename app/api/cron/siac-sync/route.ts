import { NextRequest, NextResponse } from "next/server";
import { getSiacConfig } from "@/lib/siac/client";
import { runDailySync } from "@/lib/collections/sync";
import { notifySlack } from "@/lib/collections/notify";

// Una sola llamada a SIAC; el margen es para la escritura en la base.
export const maxDuration = 120;
export const dynamic = "force-dynamic";

/**
 * Foto diaria de la cartera (una llamada a ListadoCobranzaJSON). La disparan
 * los crons de vercel.json con `Authorization: Bearer $CRON_SECRET`:
 *
 *   6:00 CDMX   /api/cron/siac-sync               foto de hoy
 *   9:00 CDMX   /api/cron/siac-sync?reintento=1   solo si la de las 6:00 no quedó completa
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
    return NextResponse.json(result, { status: result.status === "error" ? 500 : 200 });
  } catch (e) {
    // Errores antes de poder registrar la corrida (base caída, fecha inválida).
    const mensaje = (e as Error).message;
    await notifySlack(`:rotating_light: La sincronización de cartera con SIAC no pudo arrancar: ${mensaje}`);
    return NextResponse.json({ error: mensaje }, { status: 500 });
  }
}
