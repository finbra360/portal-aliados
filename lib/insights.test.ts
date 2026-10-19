import test from "node:test";
import assert from "node:assert/strict";
import { getInsights } from "./insights.ts";
import { getTierProgress } from "./tiers.ts";
import type { BrokerContext } from "./broker-data.ts";

const limpio = (s: string) => s.replace(/ /g, " ");

function contexto(o: Partial<BrokerContext> = {}): BrokerContext {
  const ranking = [
    { brokerId: "A", nombre: "Ana", totalColocado: 3_000_000, numOperaciones: 3, ticketPromedio: 1_000_000 },
    { brokerId: "B", nombre: "Beto", totalColocado: 2_000_000, numOperaciones: 2, ticketPromedio: 1_000_000 },
  ];
  return {
    stats: { totalHistorico: 2_000_000, creditosCount: 2, porMes: [], operaciones: [] },
    leaderboard: { ranking, criterioActual: "monto" },
    tier: getTierProgress(2_000_000),
    streak: 0,
    position: 2,
    totalBrokers: 2,
    mesActual: { mes: "Oct", anio: 2026, monto: 0 },
    mesAnterior: { mes: "Sep", anio: 2026, monto: 0 },
    deltaMesPct: null,
    ...o,
  };
}

test("racha: solo se menciona desde 2 meses seguidos", () => {
  assert.ok(!getInsights(contexto({ streak: 1 })).some((i) => i.includes("seguidos")));
  assert.ok(getInsights(contexto({ streak: 3 })).some((i) => i.includes("3 meses seguidos")));
});

test("ranking: cuánto falta para subir un puesto", () => {
  const i = getInsights(contexto()).map(limpio);
  assert.ok(i.some((t) => t.includes("$1,000,000") && t.includes("puesto #1")));
});

test("el primer lugar lo dice y no inventa a quién alcanzar", () => {
  const i = getInsights(contexto({ position: 1 }));
  assert.ok(i.some((t) => t.includes("primer lugar")));
  assert.ok(!i.some((t) => t.includes("subir al puesto")));
});

test("con un solo broker no hay mensajes de ranking", () => {
  const i = getInsights(contexto({ totalBrokers: 1, position: 1 }));
  assert.ok(!i.some((t) => t.includes("lugar") || t.includes("puesto")));
});

test("nivel: lo que falta para el siguiente", () => {
  const i = getInsights(contexto()).map(limpio);
  assert.ok(i.some((t) => t.startsWith("Te faltan $") && t.includes("para el nivel")));
});

test("en el último nivel no hay mensaje de nivel", () => {
  const i = getInsights(contexto({ tier: getTierProgress(999_000_000) }));
  assert.ok(!i.some((t) => t.includes("para el nivel")));
});

test("comparación con el mes pasado: solo si subió", () => {
  assert.ok(getInsights(contexto({ deltaMesPct: 25 })).some((t) => t.includes("+25%")));
  assert.ok(!getInsights(contexto({ deltaMesPct: -10 })).some((t) => t.includes("subió")));
  assert.ok(!getInsights(contexto({ deltaMesPct: null })).some((t) => t.includes("subió")));
});
