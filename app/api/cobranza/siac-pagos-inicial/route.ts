import { NextRequest, NextResponse } from "next/server";
import { getSiacConfig } from "@/lib/siac/client";
import { runInitialPaymentsLoad } from "@/lib/collections/payments";

export const maxDuration = 120;
export const dynamic = "force-dynamic";

/**
 * Carga única de la historia de pagos (ConsultarPagos, un crédito por
 * segundo, a lo más un minuto por llamada). Se corre a mano, con el mismo
 * secreto que el cron, hasta que `pendientes` sea 0:
 *
 *   POST /api/cobranza/siac-pagos-inicial
 *
 * No hace nada mientras col_settings.carga_inicial_pagos.autorizada sea
 * false: SIAC tiene que dar el visto bueno antes, porque es un servicio
 * individual.
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
    const result = await runInitialPaymentsLoad({ disparadoPor: "manual" });
    const status = result.status === "no_autorizada" ? 409 : result.status === "error" ? 500 : 200;
    return NextResponse.json(result, { status });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
