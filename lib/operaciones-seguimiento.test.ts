import test from "node:test";
import assert from "node:assert/strict";
import { diasEntre, pasosDeSeguimiento } from "./operaciones-seguimiento.ts";

type Etapa = Parameters<typeof pasosDeSeguimiento>[0];
const h = (etapa: Etapa, fecha: string) => ({ etapa, fecha });
const estados = (p: ReturnType<typeof pasosDeSeguimiento>) => p.map((x) => `${x.etapa}:${x.estado}`);

test("en análisis: lo anterior hecho, lo siguiente pendiente, con la fecha de cada paso alcanzado", () => {
  const p = pasosDeSeguimiento("en_analisis", [h("recibida", "2026-10-01T10:00:00Z"), h("en_analisis", "2026-10-03T10:00:00Z")]);
  assert.deepEqual(estados(p), [
    "recibida:hecho",
    "documentacion_pendiente:hecho",
    "en_analisis:actual",
    "aprobada:pendiente",
    "formalizacion:pendiente",
    "fondeada:pendiente",
  ]);
  assert.equal(p[0].fecha, "2026-10-01T10:00:00Z");
  assert.equal(p[1].fecha, null); // se saltó la documentación: no hay fecha que inventar
  assert.equal(p[2].fecha, "2026-10-03T10:00:00Z");
  assert.equal(p[3].fecha, null);
});

test("documentación pendiente es el paso actual y marca lo de adelante como pendiente", () => {
  const p = pasosDeSeguimiento("documentacion_pendiente", [h("recibida", "2026-10-01T10:00:00Z"), h("documentacion_pendiente", "2026-10-02T10:00:00Z")]);
  assert.equal(p[1].estado, "actual");
  assert.equal(p[2].estado, "pendiente");
});

test("si regresa de un paso, lo que ya había alcanzado adelante vuelve a pendiente y sin fecha", () => {
  const p = pasosDeSeguimiento("documentacion_pendiente", [
    h("recibida", "2026-10-01T10:00:00Z"),
    h("en_analisis", "2026-10-02T10:00:00Z"),
    h("documentacion_pendiente", "2026-10-04T10:00:00Z"),
  ]);
  assert.equal(p[2].estado, "pendiente");
  assert.equal(p[2].fecha, null);
  assert.equal(p[1].fecha, "2026-10-04T10:00:00Z");
});

test("la fecha de un paso es la primera vez que llegó, aunque el historial venga desordenado", () => {
  const p = pasosDeSeguimiento("aprobada", [h("aprobada", "2026-10-09T10:00:00Z"), h("recibida", "2026-10-05T10:00:00Z"), h("recibida", "2026-10-01T10:00:00Z")]);
  assert.equal(p[0].fecha, "2026-10-01T10:00:00Z");
});

test("rechazada: conserva los pasos alcanzados y cierra con Rechazada", () => {
  const p = pasosDeSeguimiento("rechazada", [h("recibida", "2026-10-01T10:00:00Z"), h("en_analisis", "2026-10-03T10:00:00Z"), h("rechazada", "2026-10-06T10:00:00Z")]);
  assert.deepEqual(estados(p), ["recibida:hecho", "documentacion_pendiente:hecho", "en_analisis:hecho", "rechazada:rechazada"]);
  assert.equal(p.at(-1)?.fecha, "2026-10-06T10:00:00Z");
});

test("rechazada sin historial: solo el paso Rechazada", () => {
  assert.deepEqual(estados(pasosDeSeguimiento("rechazada", [])), ["rechazada:rechazada"]);
});

test("fondeada: todos hechos, el último es el actual", () => {
  const p = pasosDeSeguimiento("fondeada", []);
  assert.equal(p.at(-1)?.estado, "actual");
  assert.ok(p.slice(0, -1).every((x) => x.estado === "hecho"));
});

test("diasEntre cuenta días completos y no baja de cero", () => {
  assert.equal(diasEntre("2026-10-01T10:00:00Z", "2026-10-04T09:00:00Z"), 2);
  assert.equal(diasEntre("2026-10-05T00:00:00Z", "2026-10-01T00:00:00Z"), 0);
});
