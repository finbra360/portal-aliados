import { test } from "node:test";
import assert from "node:assert/strict";
import {
  addDays,
  aggregateClient,
  bucketFor,
  campoTelefonoPrincipal,
  daysBetween,
  deriveClientAlerts,
  deriveCreditEvents,
  fechaMexico,
  normalizePhoneMx,
  photoFreshness,
  resolvePromiseAproximada,
  resolvePromiseConPagos,
  type CreditState,
} from "./rules.ts";

const credito = (over: Partial<CreditState> = {}): CreditState => ({
  fechaCorte: "2026-09-28",
  antiguedad: 0,
  totalVencido: 0,
  vencimientosVencidos: 0,
  fechaUltimoPago: "2026-09-15",
  ...over,
});

test("fechas en hora de Ciudad de México", () => {
  // 03:00 UTC del 29-sep todavía es 28-sep en CDMX (UTC-6).
  assert.equal(fechaMexico(new Date("2026-09-29T03:00:00Z")), "2026-09-28");
  assert.equal(fechaMexico(new Date("2026-09-29T07:00:00Z")), "2026-09-29");
  assert.equal(addDays("2026-02-28", 1), "2026-03-01");
  assert.equal(daysBetween("2026-09-25", "2026-09-28"), 3);
});

test("teléfonos: 52 + 10 dígitos o se marcan para corregir", () => {
  assert.equal(normalizePhoneMx("55 1234 5678"), "525512345678");
  assert.equal(normalizePhoneMx("+52 (55) 1234-5678"), "525512345678");
  assert.equal(normalizePhoneMx("5215512345678"), "525512345678");
  assert.equal(normalizePhoneMx("551234567"), null, "un dígito de menos");
  assert.equal(normalizePhoneMx("55123456789"), null, "un dígito de más");
  assert.equal(normalizePhoneMx(null), null);
});

test("teléfono principal: Celular y, si viene vacío, TelefonoCliente", () => {
  assert.equal(campoTelefonoPrincipal({ celular: "5511112222", telefonoCliente: "5533334444" }), "Celular");
  assert.equal(campoTelefonoPrincipal({ celular: null, telefonoCliente: "5533334444" }), "TelefonoCliente");
  assert.equal(campoTelefonoPrincipal({ celular: " - ", telefonoCliente: "5533334444" }), "TelefonoCliente", "sin dígitos cuenta como vacío");
  assert.equal(campoTelefonoPrincipal({ celular: null, telefonoCliente: null }), null);
});

test("buckets de aging sobre Antiguedad", () => {
  assert.equal(bucketFor(0), "al_corriente");
  assert.equal(bucketFor(1), "1-7");
  assert.equal(bucketFor(8), "8-30");
  assert.equal(bucketFor(31), "31-60");
  assert.equal(bucketFor(90), "61-90");
  assert.equal(bucketFor(91), "90+");
});

test("primera foto de un crédito: sin eventos", () => {
  assert.deepEqual(deriveCreditEvents(null, credito({ antiguedad: 40, totalVencido: 5000 })), []);
});

test("pago detectado por el cambio de FechaUltimoPago, sin monto", () => {
  const ev = deriveCreditEvents(credito(), credito({ fechaCorte: "2026-09-29", fechaUltimoPago: "2026-09-28" }));
  assert.deepEqual(ev.map((e) => [e.tipo, e.fechaEvento]), [["pago_detectado", "2026-09-28"]]);
  assert.ok(!("monto" in ev[0]));
});

test("entrada a mora con su fecha exacta aunque falten fotos", () => {
  // Última foto el 20 al corriente; la de hoy (29) trae 4 días de atraso: entró el 25.
  const ev = deriveCreditEvents(credito({ fechaCorte: "2026-09-20" }), credito({ fechaCorte: "2026-09-29", antiguedad: 4, totalVencido: 10_050 }));
  assert.deepEqual(ev.map((e) => [e.tipo, e.fechaEvento]), [["entrada_mora", "2026-09-25"]]);
});

test("regularización y nueva mensualidad vencida", () => {
  const enMora = credito({ antiguedad: 20, totalVencido: 10_000, vencimientosVencidos: 1 });
  const otra = deriveCreditEvents(enMora, credito({ fechaCorte: "2026-09-29", antiguedad: 21, totalVencido: 20_100, vencimientosVencidos: 2 }));
  assert.deepEqual(otra.map((e) => e.tipo), ["nueva_mensualidad_vencida"]);

  const paga = deriveCreditEvents(enMora, credito({ fechaCorte: "2026-09-29", fechaUltimoPago: "2026-09-29" }));
  assert.deepEqual(paga.map((e) => e.tipo).sort(), ["pago_detectado", "regularizacion"]);
});

test("foto vieja: SIAC regresa exactamente lo mismo aunque hay créditos en atraso", () => {
  const ayer = new Map([["a", credito({ fechaCorte: "2026-09-28", antiguedad: 5, totalVencido: 10_000 })], ["b", credito({ fechaCorte: "2026-09-28" })]]);
  const igual = new Map([["a", credito({ fechaCorte: "2026-09-29", antiguedad: 5, totalVencido: 10_000 })], ["b", credito({ fechaCorte: "2026-09-29" })]]);
  assert.equal(photoFreshness(ayer, igual), "vieja");

  const nueva = new Map([["a", credito({ fechaCorte: "2026-09-29", antiguedad: 6, totalVencido: 10_025 })], ["b", credito({ fechaCorte: "2026-09-29" })]]);
  assert.equal(photoFreshness(ayer, nueva), "actualizada");
});

test("foto vieja: sin créditos en atraso no hay forma de saberlo", () => {
  const ayer = new Map([["b", credito({ fechaCorte: "2026-09-28" })]]);
  const hoy = new Map([["b", credito({ fechaCorte: "2026-09-29" })]]);
  assert.equal(photoFreshness(ayer, hoy), "sin_evidencia");
  assert.equal(photoFreshness(new Map(), hoy), "sin_evidencia", "primera corrida");
});

test("foto vieja: un crédito nuevo o uno que sale cuentan como cambio", () => {
  const ayer = new Map([["a", credito({ fechaCorte: "2026-09-28", antiguedad: 5 })]]);
  const conNuevo = new Map([["a", credito({ fechaCorte: "2026-09-29", antiguedad: 5 })], ["z", credito({ fechaCorte: "2026-09-29" })]]);
  assert.equal(photoFreshness(ayer, conNuevo), "actualizada");
  assert.equal(photoFreshness(new Map([...ayer, ["b", credito()]]), new Map([["a", credito({ fechaCorte: "2026-09-29", antiguedad: 5 })]])), "actualizada");
});

test("mora por cliente: se suman sus créditos contra el umbral", () => {
  const prev = aggregateClient([credito({ totalVencido: 400 }), credito({ totalVencido: 500 })]);
  const curr = aggregateClient([credito({ totalVencido: 450, antiguedad: 3 }), credito({ totalVencido: 600, antiguedad: 3 })]);
  assert.equal(curr.totalVencido, 1050);
  const al = deriveClientAlerts(prev, curr, "k1", 1000, "2026-09-29");
  assert.deepEqual(al.map((a) => [a.tipo, a.dedupeKey]), [["entrada_mora", "entrada_mora:k1"]]);
  assert.deepEqual(deriveClientAlerts(prev, aggregateClient([credito({ totalVencido: 950, antiguedad: 3 })]), "k1", 1000, "2026-09-29"), [], "residuos bajo el umbral");
});

test("mora por cliente: nueva mensualidad vencida y cambio de bucket", () => {
  const prev = aggregateClient([credito({ totalVencido: 10_000, antiguedad: 30, vencimientosVencidos: 1 })]);
  const curr = aggregateClient([credito({ totalVencido: 20_000, antiguedad: 31, vencimientosVencidos: 2 })]);
  const al = deriveClientAlerts(prev, curr, "k1", 1000, "2026-09-29");
  assert.deepEqual(al.map((a) => [a.tipo, a.severidad]), [["nueva_mensualidad_vencida", "atencion"], ["cambio_bucket", "atencion"]]);

  const p90 = aggregateClient([credito({ totalVencido: 50_000, antiguedad: 90 })]);
  const c91 = aggregateClient([credito({ totalVencido: 50_100, antiguedad: 91 })]);
  assert.equal(deriveClientAlerts(p90, c91, "k1", 1000, "2026-09-29")[0].severidad, "critica");
});

test("promesas sin montos de pago (respaldo aproximado)", () => {
  const p = { monto: 10_000, creadaEl: "2026-10-01", fechaCompromiso: "2026-10-05", vencidoAlCrear: 25_000 };
  // Pagó el 4 y el vencido bajó 12,000: cumplida.
  assert.equal(resolvePromiseAproximada(p, ["2026-10-04"], 13_000, "2026-10-04", 1000), "cumplida");
  // Pagó, pero el vencido solo bajó 3,000: parcial, y solo al terminar la gracia.
  assert.equal(resolvePromiseAproximada(p, ["2026-10-04"], 22_000, "2026-10-05", 1000), "vigente");
  assert.equal(resolvePromiseAproximada(p, ["2026-10-04"], 22_000, "2026-10-06", 1000), "parcial");
  // Quedó por debajo del umbral: cumplida aunque la resta no alcance.
  assert.equal(resolvePromiseAproximada({ ...p, vencidoAlCrear: 1_200 }, ["2026-10-04"], 300, "2026-10-04", 1000), "cumplida");
  // No pagó.
  assert.equal(resolvePromiseAproximada(p, [], 25_300, "2026-10-05", 1000), "vigente");
  assert.equal(resolvePromiseAproximada(p, [], 25_300, "2026-10-06", 1000), "incumplida");
  // Un pago anterior a la promesa no cuenta.
  assert.equal(resolvePromiseAproximada(p, ["2026-09-30"], 10_000, "2026-10-06", 1000), "incumplida");
});

test("promesas con los pagos de ConsultarPagos", () => {
  const p = { monto: 20_000, creadaEl: "2026-10-01", fechaCompromiso: "2026-10-05" };
  assert.deepEqual(resolvePromiseConPagos(p, [{ fecha: "2026-10-03", monto: 12_000 }, { fecha: "2026-10-04", monto: 8_000 }], "2026-10-04"), { estado: "cumplida", montoPagado: 20_000 });
  assert.equal(resolvePromiseConPagos(p, [], "2026-10-05").estado, "vigente", "todavía dentro del día de gracia");
  assert.equal(resolvePromiseConPagos(p, [], "2026-10-06").estado, "incumplida");
  const pagos = [
    { fecha: "2026-09-30", monto: 20_000 }, // antes de la promesa: no cuenta
    { fecha: "2026-10-06", monto: 5_000 }, // día de gracia: cuenta
    { fecha: "2026-10-07", monto: 20_000 }, // después de la gracia: no cuenta
  ];
  assert.deepEqual(resolvePromiseConPagos(p, pagos, "2026-10-07"), { estado: "parcial", montoPagado: 5_000 });
});
