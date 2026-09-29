import { NextRequest, NextResponse } from "next/server";
import { getSiacConfig } from "@/lib/siac/client";
import { runBackfill } from "@/lib/collections/backfill";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

/**
 * Reconstrucción histórica de la cartera. Se llama a mano, con el mismo
 * secreto que el cron, las veces que haga falta hasta que `pendientes` sea 0:
 *
 *   POST /api/cobranza/siac-backfill                  créditos pendientes
 *   POST /api/cobranza/siac-backfill?credito=1072     rehacer un crédito
 */
export async function POST(req: NextRequest) {
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

  try {
    const credito = req.nextUrl.searchParams.get("credito") ?? undefined;
    const result = await runBackfill({ disparadoPor: "manual", noControl: credito });
    return NextResponse.json(result, { status: result.status === "error" ? 500 : 200 });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
