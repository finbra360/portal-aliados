import { test } from "node:test";
import assert from "node:assert/strict";
import { armarResumen, movimientosDeLaSemana, semanaAnterior, semanaDesde, type DatosResumen } from "./resumen-semanal.ts";
import type { CambioEmbudo, NegocioEmbudo } from "./embudo.ts";

test("la semana anterior va de lunes a domingo, en hora de México", () => {
  // Lunes 30 nov 2026 → semana del 23 al 29 nov.
  const s = semanaAnterior("2026-11-30");
  assert.equal(s.desde, "2026-11-23");
  assert.equal(s.hasta, "2026-11-29");
  assert.equal(s.desdeIso, "2026-11-23T06:00:00.000Z");
  assert.equal(s.hastaIso, "2026-11-30T05:59:59.999Z");
  // Cualquier día de la semana da la misma semana anterior; el domingo todavía es de la semana en curso.
  assert.equal(semanaAnterior("2026-12-03").desde, "2026-11-23");
  assert.equal(semanaAnterior("2026-12-06").desde, "2026-11-23");
  // Cruce de año.
  assert.deepEqual([semanaAnterior("2027-01-04").desde, semanaAnterior("2027-01-04").hasta], ["2026-12-28", "2027-01-03"]);
});

const negocio = (id: string, empresa: string, etapa: NegocioEmbudo["etapa"], etapaDesde: string, monto: number | null): NegocioEmbudo => ({
  id,
  empresa,
  origen: "broker",
  responsable: null,
  broker: null,
  creadoAt: "2026-10-01T18:00:00.000Z",
  etapa,
  etapaDesde,
  monto,
});

test("avances y dispersados de la semana (sin lo que puso el importador)", () => {
  const s = semanaDesde("2026-11-23");
  const negocios = [
    negocio("a", "Empresa Ficticia A", "dispersado", "2026-11-25T18:00:00.000Z", 500000),
    negocio("b", "Empresa Ficticia B", "dispersado", "2026-11-26T18:00:00.000Z", 900000),
    negocio("c", "Empresa Ficticia C", "dispersado", "2026-11-20T18:00:00.000Z", 700000), // la semana anterior
  ];
  const cambios: CambioEmbudo[] = [
    { negocioId: "a", de: "formalizacion", a: "dispersado", ocurridoAt: "2026-11-25T18:00:00.000Z" },
    { negocioId: "x", de: "prospecto", a: "calificado", ocurridoAt: "2026-11-24T18:00:00.000Z" },
    { negocioId: "y", de: "oferta", a: "solicitud", ocurridoAt: "2026-11-24T18:00:00.000Z" }, // regresó: no cuenta
    { negocioId: "z", de: "prospecto", a: "rechazado", ocurridoAt: "2026-11-24T18:00:00.000Z" }, // cierre: no es avance
    { negocioId: "w", de: "prospecto", a: "dispersado", ocurridoAt: "2026-11-24T18:00:00.000Z", importado: true },
    { negocioId: "v", de: null, a: "prospecto", ocurridoAt: "2026-11-24T18:00:00.000Z" }, // alta
    { negocioId: "u", de: "prospecto", a: "calificado", ocurridoAt: "2026-11-30T07:00:00.000Z" }, // ya es la otra semana
  ];
  const m = movimientosDeLaSemana(negocios, cambios, s);
  assert.equal(m.avances, 2);
  assert.deepEqual(m.dispersados.map((x) => x.empresa), ["Empresa Ficticia B", "Empresa Ficticia A"]);
});

const base: DatosResumen = {
  semana: semanaDesde("2026-11-23"),
  urlBase: "https://backoffice.ejemplo.test",
  actual: {
    entraron: 3,
    dispersados: { n: 1, monto: 900000, ticket: 900000, ciclo: 30, cicloP75: 30 },
    rechazados: 1,
    pospuestos: 0,
    abiertos: [
      { etapa: "prospecto", n: 5, monto: 2_000_000 },
      { etapa: "calificado", n: 0, monto: 0 },
      { etapa: "oferta", n: 2, monto: 1_500_000 },
    ],
    atorados: [{ ...negocio("x", "Empresa Atorada", "oferta", "2026-10-01T18:00:00.000Z", 100), dias: 40 }],
    porOrigen: [
      { clave: "broker", entraron: 2, dispersados: 0, montoDispersado: 0, ticket: null, conversion: null, abiertos: 0, montoAbierto: 0 },
      { clave: "web", entraron: 1, dispersados: 0, montoDispersado: 0, ticket: null, conversion: null, abiertos: 0, montoAbierto: 0 },
    ],
  },
  anterior: { entraron: 3, dispersados: { n: 0, monto: 0, ticket: null, ciclo: null, cicloP75: null }, rechazados: 0 },
  avances: 4,
  dispersados: [{ empresa: "Empresa Ficticia B", monto: 900000 }],
  diasAtorado: 14,
  brokersSinAsignar: 29,
  sinLigar: 1,
};

test("el mensaje trae la semana, el embudo de hoy, lo que hay que atender y las ligas", () => {
  const t = armarResumen(base);
  assert.match(t, /^\*Originación — semana del 23 nov al 29 nov 2026\*/);
  assert.match(t, /Entraron \*3 negocios\* \(igual que la semana anterior\) — Broker 2, Página web 1/);
  assert.match(t, /\*4 avances\* de etapa/);
  assert.match(t, /Se dispersaron \*1\* por \*\$900,000\* \(semana anterior: 0\)/);
  assert.match(t, /Empresa Ficticia B \$900,000/);
  assert.match(t, /Se cerraron 1 rechazado$/m);
  assert.match(t, /Embudo abierto hoy:\* 7 negocios · \$3,500,000/);
  assert.match(t, /Prospecto 5 · Oferta 2/);
  assert.ok(!t.includes("Calificado 0"));
  assert.match(t, /1 negocio lleva más de 14 días en su etapa — Empresa Atorada \(40 d en Oferta\)/);
  assert.match(t, /29 negocios de broker no tienen broker asignado/);
  assert.match(t, /1 dispersado sin ligar a su crédito de SIAC/);
  assert.match(t, /<https:\/\/backoffice\.ejemplo\.test\/backoffice\/negocios\/metricas\|Ver métricas>/);
});

test("una semana sin movimiento no inventa nada", () => {
  const t = armarResumen({
    ...base,
    actual: { ...base.actual, entraron: 0, dispersados: { n: 0, monto: 0, ticket: null, ciclo: null, cicloP75: null }, rechazados: 0, atorados: [], porOrigen: [] },
    avances: 0,
    dispersados: [],
    brokersSinAsignar: 0,
    sinLigar: null,
  });
  assert.match(t, /Entraron \*0 negocios\* \(semana anterior: 3\)$/m);
  assert.match(t, /Ningún negocio avanzó de etapa/);
  assert.match(t, /Ningún dispersado \(igual que la semana anterior\)/);
  assert.ok(!t.includes("Se cerraron"));
  assert.ok(!t.includes("Para atender"));
});
