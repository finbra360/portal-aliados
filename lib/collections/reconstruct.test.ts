import { test } from "node:test";
import assert from "node:assert/strict";
import { equivalentes, monthEndsBetween, reconstruct, type DayValues } from "./reconstruct.ts";
import { daysBetween } from "./rules.ts";

/**
 * SIAC falso: crédito mensual con alta el 20-jun-2025 y mensualidad de
 * $10,000 que vence el día 24 de cada mes. Casi siempre paga el 24; en
 * noviembre paga tarde el 29 (atraso que empieza y se cura dentro del mismo
 * mes) y en enero paga en dos partes (15 y 20 de febrero). La última
 * mensualidad, que vence el 24-sep-2026, sigue sin pagarse.
 */
function siacFalso() {
  const vencimientos: string[] = [];
  for (let m = 6; m <= 20; m++) {
    const y = 2025 + Math.floor(m / 12);
    const mes = (m % 12) + 1;
    vencimientos.push(`${y}-${String(mes).padStart(2, "0")}-24`);
  }
  const pagos: { fecha: string; monto: number }[] = [];
  for (const v of vencimientos) {
    if (v === "2026-09-24") continue; // no pagada
    if (v === "2025-11-24") pagos.push({ fecha: "2025-11-29", monto: 10_000 });
    else if (v === "2026-01-24") pagos.push({ fecha: "2026-02-15", monto: 4_000 }, { fecha: "2026-02-20", monto: 6_000 });
    else pagos.push({ fecha: v, monto: 10_000 });
  }
  let consultas = 0;
  const fetchDay = async (fecha: string): Promise<DayValues> => {
    consultas++;
    // Vence al final del día: se considera vencida desde el día siguiente.
    const exigible = vencimientos.filter((v) => v < fecha).length * 10_000;
    const pagado = pagos.filter((p) => p.fecha <= fecha).reduce((s, p) => s + p.monto, 0);
    const capitalVencido = Math.max(0, exigible - pagado);
    return {
      fechaCorte: fecha,
      saldoVencido: capitalVencido,
      capitalVencido,
      sumaPagos: pagado,
      sumaCondonaciones: 0,
      sumaQuitas: 0,
      sumaCastigos: 0,
    };
  };
  return { fetchDay, consultas: () => consultas, pagos };
}

test("fines de mes entre dos fechas", () => {
  assert.deepEqual(monthEndsBetween("2025-06-20", "2025-09-10"), ["2025-06-30", "2025-07-31", "2025-08-31"]);
  assert.deepEqual(monthEndsBetween("2026-01-31", "2026-03-31"), ["2026-02-28"]);
  assert.deepEqual(monthEndsBetween("2026-09-01", "2026-09-27"), []);
});

test("equivalencia: sin pagos ni cambio de estado de vencido", () => {
  const d = (o: Partial<DayValues>): DayValues => ({ fechaCorte: "x", saldoVencido: 0, capitalVencido: 0, sumaPagos: 0, sumaCondonaciones: 0, sumaQuitas: 0, sumaCastigos: 0, ...o });
  assert.ok(equivalentes(d({ saldoVencido: 100 }), d({ saldoVencido: 900 })), "el vencido crece con moratorios: sigue igual");
  assert.ok(!equivalentes(d({}), d({ saldoVencido: 1 })));
  assert.ok(!equivalentes(d({ sumaPagos: 10 }), d({ sumaPagos: 20 })));
});

test("reconstruye cada pago y cada atraso con su día exacto", async () => {
  const siac = siacFalso();
  const r = await reconstruct("2025-06-20", "2026-09-27", siac.fetchDay);

  const pagos = r.eventos.filter((e) => e.tipo === "pago").map((e) => [e.fechaEvento, e.monto]);
  assert.deepEqual(pagos, siac.pagos.map((p) => [p.fecha, p.monto]), "los 16 pagos (15 mensualidades, una en dos partes), con su fecha y monto");

  const atrasos = r.eventos.filter((e) => e.tipo !== "pago").map((e) => [e.tipo, e.fechaEvento]);
  assert.deepEqual(atrasos, [
    ["entrada_vencido", "2025-11-25"], // atraso dentro del mismo mes
    ["regularizacion", "2025-11-29"],
    ["entrada_vencido", "2026-01-25"],
    ["regularizacion", "2026-02-20"], // el pago parcial del 15 no lo cura
    ["entrada_vencido", "2026-09-25"],
  ]);

  const ultimo = r.estados.at(-1)!;
  assert.equal(ultimo.vencidoDesde, "2026-09-25");
  assert.equal(daysBetween(ultimo.vencidoDesde!, ultimo.fechaCorte), 2);

  // Presupuesto: 17 puntos base (alta, 15 fines de mes y el final) + ~5 por cada cambio.
  assert.equal(siac.consultas(), r.consultadas.length);
  assert.ok(siac.consultas() < 130, `demasiadas consultas: ${siac.consultas()}`);
  console.log(`  consultas a SIAC para 15 meses: ${siac.consultas()}`);
});

test("no vuelve a pedir las fotos que ya tenemos", async () => {
  const siac = siacFalso();
  const conocida = await siac.fetchDay("2026-09-27");
  const antes = siac.consultas();
  const r = await reconstruct("2026-09-01", "2026-09-27", siac.fetchDay, [conocida]);
  assert.ok(!r.consultadas.includes("2026-09-27"));
  assert.equal(siac.consultas() - antes, r.consultadas.length);
});

test("rellena un hueco largo entre fotos diarias sin volver a pedir las que ya existen", async () => {
  const siac = siacFalso();
  // Fotos diarias del 1 al 5 de noviembre y del 28 al 30; se perdieron las del 6 al 27.
  const diarias: DayValues[] = [];
  for (const d of ["01", "02", "03", "04", "05", "28", "29", "30"]) diarias.push(await siac.fetchDay(`2025-11-${d}`));
  const r = await reconstruct("2025-11-01", "2025-11-30", siac.fetchDay, diarias);
  assert.ok(r.consultadas.every((f) => f > "2025-11-05" && f < "2025-11-28"), "solo pide días del hueco");
  assert.deepEqual(r.eventos.filter((e) => e.tipo !== "pago").map((e) => [e.tipo, e.fechaEvento]), [
    ["entrada_vencido", "2025-11-25"],
    ["regularizacion", "2025-11-29"],
  ]);
});
