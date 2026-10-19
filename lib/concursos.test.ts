import test from "node:test";
import assert from "node:assert/strict";
import {
  avanceHaciaMeta,
  diasRestantes,
  etapaDelPeriodo,
  ganadoresDeConcurso,
  posicionesDeConcurso,
  validarConcurso,
  type DatosConcurso,
} from "./concursos.ts";

const octubre: DatosConcurso = { fechaInicio: "2026-10-01", fechaFin: "2026-10-31", criterio: "monto", metaObjetivo: null, numGanadores: 2 };
const nombres = new Map([["A", "Ana"], ["B", "Beto"], ["C", "Caro"]]);
const col = (brokerId: string, fecha: string, monto: number) => ({ brokerId, fecha, monto });

test("solo cuenta la colocación dentro del periodo, con ambos días incluidos", () => {
  const p = posicionesDeConcurso(
    octubre,
    [col("A", "2026-09-30", 900), col("A", "2026-10-01", 100), col("A", "2026-10-31", 200), col("A", "2026-11-01", 700)],
    nombres,
  );
  assert.equal(p.length, 1);
  assert.equal(p[0].valor, 300);
  assert.equal(p[0].operaciones, 2);
});

test("criterio operaciones cuenta créditos, no pesos", () => {
  const c = { ...octubre, criterio: "operaciones" as const };
  const p = posicionesDeConcurso(c, [col("A", "2026-10-02", 5000), col("B", "2026-10-03", 10), col("B", "2026-10-04", 10)], nombres);
  assert.deepEqual(p.map((x) => [x.brokerId, x.valor]), [["B", 2], ["A", 1]]);
});

test("empate: gana quien llegó primero a ese valor", () => {
  const p = posicionesDeConcurso(octubre, [col("A", "2026-10-20", 500), col("B", "2026-10-10", 500)], nombres);
  assert.deepEqual(p.map((x) => x.brokerId), ["B", "A"]);
  assert.equal(p[0].lugar, 1);
});

test("empate total se resuelve por ID para que el resultado sea siempre el mismo", () => {
  const p = posicionesDeConcurso(octubre, [col("B", "2026-10-10", 500), col("A", "2026-10-10", 500)], nombres);
  assert.deepEqual(p.map((x) => x.brokerId), ["A", "B"]);
});

test("los excluidos no cuentan y no ocupan lugar", () => {
  const p = posicionesDeConcurso(octubre, [col("A", "2026-10-02", 900), col("B", "2026-10-02", 100)], nombres, ["A"]);
  assert.deepEqual(p.map((x) => [x.brokerId, x.lugar]), [["B", 1]]);
});

test("sin meta, ganan los primeros N con colocación", () => {
  const p = posicionesDeConcurso(octubre, [col("A", "2026-10-02", 300), col("B", "2026-10-02", 200), col("C", "2026-10-02", 100)], nombres);
  assert.deepEqual(ganadoresDeConcurso(p).map((x) => [x.brokerId, x.premio]), [["A", 1], ["B", 2]]);
  assert.equal(p[2].premio, null);
});

test("con meta, solo ganan quienes la alcanzan; el premio pasa al siguiente que cumple", () => {
  const c = { ...octubre, metaObjetivo: 250, numGanadores: 2 };
  const p = posicionesDeConcurso(c, [col("A", "2026-10-02", 900), col("B", "2026-10-02", 100), col("C", "2026-10-02", 260)], nombres);
  assert.deepEqual(p.map((x) => [x.brokerId, x.cumpleMeta, x.premio]), [["A", true, 1], ["C", true, 2], ["B", false, null]]);
});

test("con meta que nadie alcanza no hay ganadores", () => {
  const c = { ...octubre, metaObjetivo: 10_000 };
  const p = posicionesDeConcurso(c, [col("A", "2026-10-02", 300)], nombres);
  assert.deepEqual(ganadoresDeConcurso(p), []);
});

test("nombre desconocido cae al ID", () => {
  assert.equal(posicionesDeConcurso(octubre, [col("Z9", "2026-10-02", 1)], nombres)[0].nombre, "Z9");
});

test("etapa del periodo y días restantes", () => {
  assert.equal(etapaDelPeriodo(octubre, "2026-09-30"), "proximo");
  assert.equal(etapaDelPeriodo(octubre, "2026-10-01"), "en_curso");
  assert.equal(etapaDelPeriodo(octubre, "2026-10-31"), "en_curso");
  assert.equal(etapaDelPeriodo(octubre, "2026-11-01"), "terminado");
  assert.equal(diasRestantes("2026-10-31", "2026-10-31"), 1);
  assert.equal(diasRestantes("2026-10-31", "2026-10-18"), 14);
  assert.equal(diasRestantes("2026-10-31", "2026-11-05"), 0);
});

test("avance hacia la meta: tope 100 y null sin meta", () => {
  assert.equal(avanceHaciaMeta(50, 200), 25);
  assert.equal(avanceHaciaMeta(900, 200), 100);
  assert.equal(avanceHaciaMeta(50, null), null);
});

const base = { nombre: "Concurso de octubre", fechaInicio: "2026-10-01", fechaFin: "2026-10-31", criterio: "monto", premio: "Viaje", numGanadores: "1" };

test("validar: concurso correcto, con meta con formato de dinero", () => {
  const r = validarConcurso({ ...base, meta: "$1,500,000" }, "2026-10-18");
  assert.ok(r.ok);
  if (r.ok) assert.equal(r.metaObjetivo, 1_500_000);
});

test("validar: rechaza datos incompletos o incoherentes", () => {
  const v = (o: object) => validarConcurso({ ...base, ...o }, "2026-10-18").ok;
  assert.equal(v({ nombre: " " }), false);
  assert.equal(v({ premio: "" }), false);
  assert.equal(v({ criterio: "otro" }), false);
  assert.equal(v({ fechaFin: "2026-09-30" }), false); // termina antes de empezar
  assert.equal(v({ fechaInicio: "2026-02-31" }), false);
  assert.equal(v({ fechaInicio: "2026-08-01", fechaFin: "2026-08-31" }), false); // ya pasó
  assert.equal(v({ numGanadores: "0" }), false);
  assert.equal(v({ numGanadores: "2.5" }), false);
  assert.equal(v({ numGanadores: "51" }), false);
  assert.equal(v({ meta: "-5" }), false);
  assert.equal(v({ meta: "abc" }), false);
  assert.equal(v({ criterio: "operaciones", meta: "2.5" }), false);
  assert.equal(v({ criterio: "operaciones", meta: "3" }), true);
});
