import { test } from "node:test";
import assert from "node:assert/strict";
import { diasCubiertos, esDiaHabil } from "./dias-habiles.ts";

test("días hábiles: lunes a viernes sin feriados bancarios", () => {
  assert.equal(esDiaHabil("2026-11-06"), true, "viernes");
  assert.equal(esDiaHabil("2026-11-07"), false, "sábado");
  assert.equal(esDiaHabil("2026-11-08"), false, "domingo");
  assert.equal(esDiaHabil("2026-11-16"), false, "feriado (lunes)");
  assert.equal(esDiaHabil("2026-11-17"), true);
});

test("el viernes cubre el fin de semana; un día inhábil no cubre nada", () => {
  assert.deepEqual(diasCubiertos("2026-11-06"), ["2026-11-06", "2026-11-07", "2026-11-08"]);
  assert.deepEqual(diasCubiertos("2026-11-13"), ["2026-11-13", "2026-11-14", "2026-11-15", "2026-11-16"], "puente con lunes feriado");
  assert.deepEqual(diasCubiertos("2026-11-10"), ["2026-11-10"]);
  assert.deepEqual(diasCubiertos("2026-11-07"), []);
});
