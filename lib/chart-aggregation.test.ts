import test from "node:test";
import assert from "node:assert/strict";
import { aggregatePorMes } from "./chart-aggregation.ts";

const serie = [
  { mes: "Nov", anio: 2025, monto: 100 },
  { mes: "Dic", anio: 2025, monto: 200 },
  { mes: "Ene", anio: 2026, monto: 300 },
  { mes: "Mar", anio: 2026, monto: 400 },
  { mes: "Abr", anio: 2026, monto: 500 },
];

test("por mes con varios años lleva el año corto para no confundir", () => {
  assert.deepEqual(aggregatePorMes(serie, "mes").map((p) => p.label), ["Nov 25", "Dic 25", "Ene 26", "Mar 26", "Abr 26"]);
});

test("por mes de un solo año no repite el año", () => {
  assert.deepEqual(aggregatePorMes(serie.slice(2), "mes").map((p) => p.label), ["Ene", "Mar", "Abr"]);
});

test("por trimestre suma los meses de cada uno, separando años", () => {
  assert.deepEqual(aggregatePorMes(serie, "trimestre"), [
    { label: "T4 2025", monto: 300 },
    { label: "T1 2026", monto: 700 },
    { label: "T2 2026", monto: 500 },
  ]);
});

test("por año suma todo el año", () => {
  assert.deepEqual(aggregatePorMes(serie, "anio"), [
    { label: "2025", monto: 300 },
    { label: "2026", monto: 1200 },
  ]);
});

test("sin datos no hay puntos", () => {
  assert.deepEqual(aggregatePorMes([], "mes"), []);
  assert.deepEqual(aggregatePorMes([], "trimestre"), []);
  assert.deepEqual(aggregatePorMes([], "anio"), []);
});
