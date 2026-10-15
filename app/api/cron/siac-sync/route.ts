import { NextRequest, NextResponse } from "next/server";
import { getSiacConfig } from "@/lib/siac/client";
import { runDailySync } from "@/lib/collections/sync";
import { notifySlack } from "@/lib/collections/notify";
import { runMoraReminders, type MoraRunResult } from "@/lib/db/whatsapp-mora";
import { obtenerMontosPreventivos, runPreventivos } from "@/lib/db/whatsapp-preventivo";
import { enviarReporteDiario } from "@/lib/db/reporte";

// Una sola llamada a SIAC para la foto y, a las 9:00, hasta MAX_CONSULTAS_MONTO consultas de saldo (montos de
// preventivos) y max_envios_mora_por_dia mensajes de WhatsApp (~0.75 s cada uno).
export const maxDuration = 120;
export const dynamic = "force-dynamic";

/**
 * Foto diaria de la cartera (una llamada a ListadoCobranzaJSON). La disparan
 * los crons de vercel.json con `Authorization: Bearer $CRON_SECRET`:
 *
 *   6:00 CDMX   /api/cron/siac-sync               foto de hoy
 *   9:00 CDMX   /api/cron/siac-sync?reintento=1   solo si la de las 6:00 no quedó completa,
 *                                                 después los recordatorios de WhatsApp (mora y preventivos)
 *                                                 y al final el reporte diario a Slack
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
    // Primero mora y luego preventivos: un cliente en mora no recibe preventivo.
    const whatsapp: Record<string, MoraRunResult | { error: string }> = {};
    if (reintento && result.status !== "error") {
      const tandas = [
        { clave: "mora", nombre: "de mora", correr: () => runMoraReminders({ disparadoPor: "cron" }) },
        {
          clave: "preventivos",
          nombre: "preventivos",
          // Antes de mandar, pregunta a SIAC el monto de la mensualidad de los que hoy reciben recordatorio
          // (una consulta por crédito y vencimiento, con tope). Solo si hoy de verdad se van a mandar.
          correr: async () => {
            const m = await obtenerMontosPreventivos({ actor: "cron", soloSiSeEnvia: true });
            if (m.fallidos > 0 || m.pendientes > 0) {
              await notifySlack(`:warning: Montos de preventivos: ${m.consultados} consultados a SIAC, ${m.fallidos} fallidos, ${m.pendientes} pendientes por el tope.`);
            }
            return runPreventivos({ disparadoPor: "cron" });
          },
        },
      ];
      for (const t of tandas) {
        try {
          const r = await t.correr();
          whatsapp[t.clave] = r;
          if (r.fallidos > 0 || r.detenido) {
            await notifySlack(`:warning: Recordatorios ${t.nombre}: ${r.enviados} enviados, ${r.fallidos} fallidos.${r.detenido ? ` ${r.detenido}` : ""}`);
          }
        } catch (e) {
          whatsapp[t.clave] = { error: (e as Error).message };
          await notifySlack(`:rotating_light: Los recordatorios ${t.nombre} no pudieron correr: ${(e as Error).message}`);
        }
      }
    }
    // El reporte sale aunque la foto haya fallado: justo ese día hay que saberlo.
    let reporte: boolean | { error: string } | null = null;
    if (reintento) {
      try {
        reporte = await enviarReporteDiario({ tandas: whatsapp, actor: "cron" });
      } catch (e) {
        reporte = { error: (e as Error).message };
        console.error("Cobranza: no se pudo armar el reporte diario:", (e as Error).message);
      }
    }
    return NextResponse.json({ ...result, whatsapp, reporte }, { status: result.status === "error" ? 500 : 200 });
  } catch (e) {
    // Errores antes de poder registrar la corrida (base caída, fecha inválida).
    const mensaje = (e as Error).message;
    await notifySlack(`:rotating_light: La sincronización de cartera con SIAC no pudo arrancar: ${mensaje}`);
    return NextResponse.json({ error: mensaje }, { status: 500 });
  }
}
