import { test } from "node:test";
import assert from "node:assert/strict";
import { parseMonto, puedeConsultarSaldo, validarGestion, validarPausa, validarPromesa } from "./gestiones.ts";

const HOY = "2026-10-01";

test("gestiones: llamadas y visitas piden resultado; notas y correos piden texto", () => {
  assert.deepEqual(validarGestion({ tipo: "llamada", resultado: "no_contesto", descripcion: "" }), { ok: true, tipo: "llamada", resultado: "no_contesto", descripcion: "" });
  assert.equal(validarGestion({ tipo: "llamada", resultado: null, descripcion: "x" }).ok, false);
  assert.equal(validarGestion({ tipo: "nota", resultado: null, descripcion: "   " }).ok, false);
  const nota = validarGestion({ tipo: "nota", resultado: "contesto", descripcion: " Dijo que paga el viernes " });
  assert.deepEqual(nota, { ok: true, tipo: "nota", resultado: null, descripcion: "Dijo que paga el viernes" }, "una nota no guarda resultado");
  assert.equal(validarGestion({ tipo: "fax", resultado: null, descripcion: "x" }).ok, false);
});

test("montos escritos por una persona", () => {
  assert.equal(parseMonto("12,500.50"), 12500.5);
  assert.equal(parseMonto("$ 8000"), 8000);
  assert.equal(parseMonto("0"), null);
  assert.equal(parseMonto("12.345"), null);
  assert.equal(parseMonto("doce mil"), null);
});

test("promesas: fecha entre hoy y 60 días", () => {
  assert.deepEqual(validarPromesa({ monto: "20,000", fecha: "2026-10-05", hoy: HOY }), { ok: true, monto: 20000, fecha: "2026-10-05" });
  assert.equal(validarPromesa({ monto: "20000", fecha: HOY, hoy: HOY }).ok, true, "hoy mismo vale");
  assert.match((validarPromesa({ monto: "20000", fecha: "2026-09-30", hoy: HOY }) as { error: string }).error, /pasada/);
  assert.match((validarPromesa({ monto: "20000", fecha: "2026-12-15", hoy: HOY }) as { error: string }).error, /reestructura/);
  assert.equal(validarPromesa({ monto: "-5", fecha: "2026-10-05", hoy: HOY }).ok, false);
});

test("pausas: después de hoy, hasta 90 días, con motivo", () => {
  assert.deepEqual(validarPausa({ hasta: "2026-10-15", motivo: " Negociando ", hoy: HOY }), { ok: true, hasta: "2026-10-15", motivo: "Negociando" });
  assert.equal(validarPausa({ hasta: HOY, motivo: "x", hoy: HOY }).ok, false);
  assert.equal(validarPausa({ hasta: "2027-03-01", motivo: "x", hoy: HOY }).ok, false);
  assert.equal(validarPausa({ hasta: "2026-10-15", motivo: "", hoy: HOY }).ok, false);
});

test("saldo al día: una consulta por crédito cada 10 minutos", () => {
  const ahora = new Date("2026-10-01T18:00:00Z");
  assert.deepEqual(puedeConsultarSaldo(null, ahora), { ok: true });
  assert.deepEqual(puedeConsultarSaldo(new Date("2026-10-01T17:55:30Z"), ahora), { ok: false, minutos: 6 });
  assert.deepEqual(puedeConsultarSaldo(new Date("2026-10-01T17:50:00Z"), ahora), { ok: true });
});
