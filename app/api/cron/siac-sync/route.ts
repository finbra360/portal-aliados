import { NextRequest, NextResponse } from "next/server";
import { getSiacConfig } from "@/lib/siac/client";
import { runDailySync } from "@/lib/collections/sync";
import { notifySlack } from "@/lib/collections/notify";

// ~100 llamadas a SIAC en lotes de 5; con huecos que rellenar pueden ser más.
export const maxDuration = 300;
export const dynamic = "force-dynamic";

/**
 * Foto diaria de la cartera. La dispara el cron de Vercel (vercel.json) con
 * `Authorization: Bearer $CRON_SECRET`. Con el mismo secreto se puede correr a
 * mano para una fecha pasada: /api/cron/siac-sync?fecha=2026-09-27
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
  const todos = req.nextUrl.searchParams.get("todos") === "1";

  try {
    const result = await runDailySync({ disparadoPor: fecha ? "manual" : "cron", fechaCorte: fecha, consultarTodosLosClientes: todos });
    return NextResponse.json(result, { status: result.status === "error" ? 500 : 200 });
  } catch (e) {
    // Errores antes de poder registrar la corrida (base caída, fecha inválida).
    const mensaje = (e as Error).message;
    await notifySlack(`:rotating_light: La sincronización de cartera con SIAC no pudo arrancar: ${mensaje}`);
    return NextResponse.json({ error: mensaje }, { status: 500 });
  }
}
