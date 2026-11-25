import { test } from "node:test";
import assert from "node:assert/strict";
import { enLaLista, pistasDeBroker, sugerenciaUnica, type ColocacionConReferencia } from "./brokers-sin-asignar.ts";

const negocio = (empresa: string, razonSocial: string | null = null, empresaId = "e1") => ({ id: "n1", empresaId, empresa, razonSocial });

const colocaciones: ColocacionConReferencia[] = [
  { brokerId: "B002", referencia: "QUIMICOS FICTICIOS DEL NORTE, S. DE R.L. DE C.V.", fecha: "2025-01-16" },
  { brokerId: "B002", referencia: "QUIMICOS FICTICIOS DEL NORTE, S. DE R.L. DE C.V.", fecha: "2026-06-16" },
  { brokerId: "B005", referencia: "Sistemas Inventados", fecha: "2025-08-25" },
  { brokerId: "B001", referencia: "CATORCE NUEVE CAPITAL, S.A. DE C.V.", fecha: "2025-08-25" },
];

test("sugiere el broker cuya colocación se parece al nombre, con la fecha más reciente", () => {
  const p = pistasDeBroker(negocio("Químicos Ficticios del Norte"), colocaciones, []);
  assert.equal(p.length, 1);
  assert.equal(p[0].brokerId, "B002");
  assert.equal(p[0].fuente, "colocacion");
  assert.equal(p[0].fecha, "2026-06-16");
  assert.equal(sugerenciaUnica(p), "B002");
});

test("usa la razón social si el nombre comercial no coincide", () => {
  const p = pistasDeBroker(negocio("PM - Sistemas", "SISTEMAS INVENTADOS SA DE CV"), colocaciones, []);
  assert.equal(p[0]?.brokerId, "B005");
});

test("una sola palabra genérica en común no basta", () => {
  assert.deepEqual(pistasDeBroker(negocio("DIEZ CERO UNO CAPITAL"), colocaciones, []), []);
});

test("otro negocio de la misma empresa con broker va primero", () => {
  const p = pistasDeBroker(negocio("Químicos Ficticios del Norte"), colocaciones, [{ empresaId: "e1", brokerId: "B009" }, { empresaId: "otra", brokerId: "B007" }]);
  assert.deepEqual(p.map((x) => [x.brokerId, x.fuente]), [["B009", "empresa"], ["B002", "colocacion"]]);
  // Dos brokers distintos: no se confirma en bloque.
  assert.equal(sugerenciaUnica(p), null);
});

test("la misma empresa y la colocación del mismo broker cuentan una vez", () => {
  const p = pistasDeBroker(negocio("Químicos Ficticios del Norte"), colocaciones, [{ empresaId: "e1", brokerId: "B002" }]);
  assert.equal(p.length, 1);
  assert.equal(p[0].fuente, "empresa");
  assert.equal(sugerenciaUnica(p), "B002");
});

test("las de origen broker siempre salen; las renovaciones solo con pista y sin descartar", () => {
  const pista = pistasDeBroker(negocio("Químicos Ficticios del Norte"), colocaciones, []);
  assert.equal(enLaLista({ renovacion: false, pistas: [], descartada: false }), true);
  assert.equal(enLaLista({ renovacion: true, pistas: [], descartada: false }), false);
  assert.equal(enLaLista({ renovacion: true, pistas: pista, descartada: false }), true);
  assert.equal(enLaLista({ renovacion: true, pistas: pista, descartada: true }), false);
});

test("sin pistas no hay sugerencia", () => {
  const p = pistasDeBroker(negocio("Empresa Sin Historia"), colocaciones, []);
  assert.deepEqual(p, []);
  assert.equal(sugerenciaUnica(p), null);
});
