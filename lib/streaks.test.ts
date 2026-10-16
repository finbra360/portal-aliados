import { test } from "node:test";
import assert from "node:assert/strict";
import { getCurrentStreak, getPeriodDelta, mesesDeCalendario } from "./streaks.ts";

const mes = (mes: string, anio: number, monto: number) => ({ mes, anio, monto });

test("mes actual y anterior son los del calendario, no los últimos con datos", () => {
  // Última colocación en junio; hoy es octubre.
  const { actual, anterior } = mesesDeCalendario([mes("May", 2026, 100), mes("Jun", 2026, 200)], "2026-10-16");
  assert.deepEqual(actual, { mes: "Oct", anio: 2026, monto: 0 });
  assert.deepEqual(anterior, { mes: "Sep", anio: 2026, monto: 0 });
});

test("mes actual con colocación y mes anterior con colocación", () => {
  const { actual, anterior } = mesesDeCalendario([mes("Sep", 2026, 300), mes("Oct", 2026, 500)], "2026-10-02");
  assert.equal(actual.monto, 500);
  assert.equal(anterior.monto, 300);
});

test("el mes anterior de enero es diciembre del año pasado", () => {
  const { actual, anterior } = mesesDeCalendario([mes("Dic", 2025, 400)], "2026-01-10");
  assert.deepEqual(actual, { mes: "Ene", anio: 2026, monto: 0 });
  assert.deepEqual(anterior, { mes: "Dic", anio: 2025, monto: 400 });
});

test("racha: meses de calendario seguidos, un mes vacío la corta", () => {
  // Enero y junio no son racha de 2: faltan los meses de en medio.
  assert.equal(getCurrentStreak([mes("Ene", 2026, 100), mes("Jun", 2026, 100)], "2026-06-20"), 1);
  assert.equal(getCurrentStreak([mes("Abr", 2026, 100), mes("May", 2026, 100), mes("Jun", 2026, 100)], "2026-06-20"), 3);
});

test("racha: si todavía no coloca este mes, sigue viva desde el mes anterior", () => {
  assert.equal(getCurrentStreak([mes("Ago", 2026, 100), mes("Sep", 2026, 100)], "2026-10-01"), 2);
});

test("racha: si dejó pasar un mes completo, se rompe", () => {
  assert.equal(getCurrentStreak([mes("Jul", 2026, 100), mes("Ago", 2026, 100)], "2026-10-01"), 0);
});

test("racha: cruza el cambio de año", () => {
  assert.equal(getCurrentStreak([mes("Nov", 2025, 1), mes("Dic", 2025, 1), mes("Ene", 2026, 1)], "2026-01-15"), 3);
});

test("racha: sin colocaciones es 0", () => {
  assert.equal(getCurrentStreak([], "2026-10-16"), 0);
});

test("delta: null si el periodo anterior no tuvo nada", () => {
  assert.equal(getPeriodDelta(100, 0), null);
  assert.equal(getPeriodDelta(150, 100), 50);
  assert.equal(getPeriodDelta(50, 100), -50);
});
