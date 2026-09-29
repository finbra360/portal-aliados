import { test } from "node:test";
import assert from "node:assert/strict";
import {
  addDays,
  bucketFor,
  daysBetween,
  deriveCreditAlerts,
  deriveDay,
  fechaMexico,
  normalizePhoneMx,
  resolvePromise,
  type DayState,
} from "./rules.ts";

const dia = (over: Partial<DayState> = {}): DayState => ({
  fechaCorte: "2026-09-24",
  saldoVencido: 0,
  capitalVencido: 0,
  sumaPagos: 1_000_000,
  sumaCondonaciones: 0,
  sumaQuitas: 0,
  sumaCastigos: 0,
  vencidoDesde: null,
  ...over,
});

test("fechas en hora de Ciudad de México", () => {
  // 03:00 UTC del 29-sep todavía es 28-sep en CDMX (UTC-6).
  assert.equal(fechaMexico(new Date("2026-09-29T03:00:00Z")), "2026-09-28");
  assert.equal(fechaMexico(new Date("2026-09-29T07:00:00Z")), "2026-09-29");
  assert.equal(addDays("2026-02-28", 1), "2026-03-01");
  assert.equal(addDays("2026-01-01", -1), "2025-12-31");
  assert.equal(daysBetween("2026-09-25", "2026-09-28"), 3);
});

test("teléfonos: se normalizan a 52 + 10 dígitos o se rechazan", () => {
  assert.equal(normalizePhoneMx("55 1234 5678"), "525512345678");
  assert.equal(normalizePhoneMx("+52 (55) 1234-5678"), "525512345678");
  assert.equal(normalizePhoneMx("5215512345678"), "525512345678");
  assert.equal(normalizePhoneMx("12345"), null);
  assert.equal(normalizePhoneMx(""), null);
  assert.equal(normalizePhoneMx(null), null);
});

test("buckets de antigüedad", () => {
  assert.equal(bucketFor(null), null);
  assert.equal(bucketFor(0), null);
  assert.equal(bucketFor(1), "1-7");
  assert.equal(bucketFor(7), "1-7");
  assert.equal(bucketFor(8), "8-30");
  assert.equal(bucketFor(31), "31-60");
  assert.equal(bucketFor(90), "61-90");
  assert.equal(bucketFor(91), "90+");
});

test("primera foto de un crédito: sin eventos y sin fecha de inicio de vencido", () => {
  const r = deriveDay(null, dia({ saldoVencido: 5000 }));
  assert.deepEqual(r, { vencidoDesde: null, events: [] });
});

test("un pago se detecta por el aumento de la suma de pagos", () => {
  const prev = dia({ fechaCorte: "2025-07-24" });
  const r = deriveDay(prev, dia({ fechaCorte: "2025-07-25", sumaPagos: 1_158_818.36 }));
  assert.equal(r.events.length, 1);
  assert.equal(r.events[0].tipo, "pago");
  assert.equal(r.events[0].monto, 158_818.36);
  assert.equal(r.events[0].fechaEvento, "2025-07-25");
});

test("entrada a vencido, racha y regularización", () => {
  const d24 = dia({ fechaCorte: "2026-09-24" });
  const e25 = deriveDay(d24, dia({ fechaCorte: "2026-09-25", saldoVencido: 159_000, capitalVencido: 149_000 }));
  assert.deepEqual(e25.events.map((e) => e.tipo), ["entrada_vencido"]);
  assert.equal(e25.vencidoDesde, "2026-09-25");

  const d25 = dia({ fechaCorte: "2026-09-25", saldoVencido: 159_000, capitalVencido: 149_000, vencidoDesde: e25.vencidoDesde });
  const e26 = deriveDay(d25, dia({ fechaCorte: "2026-09-26", saldoVencido: 159_400, capitalVencido: 149_000 }));
  assert.deepEqual(e26.events, []);
  assert.equal(e26.vencidoDesde, "2026-09-25", "la racha conserva su fecha de inicio");

  const d26 = dia({ fechaCorte: "2026-09-26", saldoVencido: 159_400, capitalVencido: 149_000, vencidoDesde: "2026-09-25" });
  const e27 = deriveDay(d26, dia({ fechaCorte: "2026-09-27", saldoVencido: 0, sumaPagos: 1_159_400 }));
  assert.deepEqual(e27.events.map((e) => e.tipo).sort(), ["pago", "regularizacion"]);
  assert.equal(e27.vencidoDesde, null);
});

test("vencido de origen desconocido sigue desconocido hasta la reconstrucción", () => {
  const prev = dia({ saldoVencido: 5000, vencidoDesde: null });
  const r = deriveDay(prev, dia({ fechaCorte: "2026-09-25", saldoVencido: 5100 }));
  assert.equal(r.vencidoDesde, null);
});

test("alerta al cruzar el umbral de mora, no por centavos", () => {
  const prev = dia({ saldoVencido: 0 });
  assert.deepEqual(deriveCreditAlerts(prev, dia({ fechaCorte: "2026-09-25", saldoVencido: 375, vencidoDesde: "2026-09-25" }), "c1"), []);
  const alerts = deriveCreditAlerts(prev, dia({ fechaCorte: "2026-09-25", saldoVencido: 18_618, vencidoDesde: "2026-09-25" }), "c1");
  assert.deepEqual(alerts.map((a) => a.tipo), ["entrada_vencido"]);
  assert.equal(alerts[0].dedupeKey, "entrada_vencido:c1");
});

test("los moratorios diarios no generan alerta; una mensualidad nueva vencida sí", () => {
  const prev = dia({ saldoVencido: 50_000, capitalVencido: 45_000, vencidoDesde: "2026-09-01", fechaCorte: "2026-09-10" });
  const soloMoratorios = dia({ saldoVencido: 50_400, capitalVencido: 45_000, vencidoDesde: "2026-09-01", fechaCorte: "2026-09-11" });
  assert.deepEqual(deriveCreditAlerts(prev, soloMoratorios, "c1"), []);
  const otraMensualidad = dia({ saldoVencido: 95_000, capitalVencido: 90_000, vencidoDesde: "2026-09-01", fechaCorte: "2026-09-11" });
  assert.deepEqual(deriveCreditAlerts(prev, otraMensualidad, "c1").map((a) => a.tipo), ["aumento_vencido"]);
});

test("cambio de bucket a 31-60 y a 90+", () => {
  const prev = dia({ saldoVencido: 50_000, capitalVencido: 45_000, vencidoDesde: "2026-08-01", fechaCorte: "2026-08-30" });
  const curr = dia({ saldoVencido: 50_100, capitalVencido: 45_000, vencidoDesde: "2026-08-01", fechaCorte: "2026-09-01" });
  const a = deriveCreditAlerts(prev, curr, "c1");
  assert.deepEqual(a.map((x) => [x.tipo, x.severidad, x.dedupeKey]), [["cambio_bucket", "atencion", "cambio_bucket:c1:31-60"]]);

  const p90 = dia({ ...curr, vencidoDesde: "2026-06-02", fechaCorte: "2026-08-31" });
  const c90 = dia({ ...curr, vencidoDesde: "2026-06-02", fechaCorte: "2026-09-01" });
  assert.equal(deriveCreditAlerts(p90, c90, "c1")[0].severidad, "critica");
});

test("promesa cumplida en cuanto se junta el monto", () => {
  const p = { monto: 20_000, creadaEl: "2026-10-01", fechaCompromiso: "2026-10-05" };
  const r = resolvePromise(p, [{ fecha: "2026-10-03", monto: 12_000 }, { fecha: "2026-10-04", monto: 8_000 }], "2026-10-04");
  assert.deepEqual(r, { estado: "cumplida", montoPagado: 20_000 });
});

test("promesa sigue vigente mientras no tengamos datos de todo el periodo de gracia", () => {
  const p = { monto: 20_000, creadaEl: "2026-10-01", fechaCompromiso: "2026-10-05" };
  assert.equal(resolvePromise(p, [], "2026-10-05").estado, "vigente");
  assert.equal(resolvePromise(p, [], "2026-10-06").estado, "incumplida");
});

test("promesa parcial, y pagos fuera de la ventana no cuentan", () => {
  const p = { monto: 20_000, creadaEl: "2026-10-01", fechaCompromiso: "2026-10-05" };
  const pagos = [
    { fecha: "2026-09-30", monto: 20_000 }, // antes de la promesa
    { fecha: "2026-10-06", monto: 5_000 }, // día de gracia: cuenta
    { fecha: "2026-10-07", monto: 20_000 }, // después de la gracia
  ];
  assert.deepEqual(resolvePromise(p, pagos, "2026-10-07"), { estado: "parcial", montoPagado: 5_000 });
});
