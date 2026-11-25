import { test } from "node:test";
import assert from "node:assert/strict";
import { calcularEmbudo, leerPeriodo, mediana, type CambioEmbudo, type NegocioEmbudo } from "./embudo.ts";

const n = (x: Partial<NegocioEmbudo> & { id: string }): NegocioEmbudo => ({
  empresa: `Empresa ${x.id}`,
  origen: "referido",
  responsable: "Ana",
  broker: null,
  creadoAt: "2026-10-01T15:00:00.000Z",
  etapa: "prospecto",
  etapaDesde: "2026-10-01T15:00:00.000Z",
  monto: 1_000_000,
  ...x,
});
const c = (negocioId: string, de: NegocioEmbudo["etapa"] | null, a: NegocioEmbudo["etapa"], dia: string): CambioEmbudo => ({ negocioId, de, a, ocurridoAt: `${dia}T15:00:00.000Z` });

// A: entró el 1-oct, se dispersó el 10-nov. B: entró el 5-oct, está en Comité desde el 1-nov.
// C: entró el 20-oct, se rechazó en Análisis. D: entró en agosto (fuera del periodo), sigue en Solicitud.
const NEGOCIOS = [
  n({ id: "A", etapa: "dispersado", etapaDesde: "2026-11-10T15:00:00.000Z", monto: 2_000_000, broker: "Broker Uno", origen: "broker" }),
  n({ id: "B", creadoAt: "2026-10-05T15:00:00.000Z", etapa: "comite", etapaDesde: "2026-11-01T15:00:00.000Z", monto: 1_500_000, responsable: "Luis" }),
  n({ id: "C", creadoAt: "2026-10-20T15:00:00.000Z", etapa: "rechazado", etapaDesde: "2026-11-05T15:00:00.000Z" }),
  n({ id: "D", creadoAt: "2026-08-01T15:00:00.000Z", etapa: "solicitud", etapaDesde: "2026-08-10T15:00:00.000Z", monto: null }),
];
const CAMBIOS = [
  c("A", null, "prospecto", "2026-10-01"),
  c("A", "prospecto", "solicitud", "2026-10-05"),
  c("A", "solicitud", "comite", "2026-10-25"),
  c("A", "comite", "formalizacion", "2026-11-01"),
  c("A", "formalizacion", "dispersado", "2026-11-10"),
  c("B", null, "prospecto", "2026-10-05"),
  c("B", "prospecto", "solicitud", "2026-10-15"),
  c("B", "solicitud", "comite", "2026-11-01"),
  c("C", null, "prospecto", "2026-10-20"),
  c("C", "prospecto", "analisis", "2026-10-25"),
  c("C", "analisis", "rechazado", "2026-11-05"),
  c("D", null, "prospecto", "2026-08-01"),
  c("D", "prospecto", "solicitud", "2026-08-10"),
];

const E = calcularEmbudo({ negocios: NEGOCIOS, cambios: CAMBIOS, desde: "2026-09-25T06:00:00.000Z", hasta: "2026-11-24T23:00:00.000Z", hoy: "2026-11-24", diasAtorado: 14 });

test("mediana y periodo", () => {
  assert.equal(mediana([]), null);
  assert.equal(mediana([5, 1, 3]), 3);
  assert.equal(mediana([4, 1, 3, 10]), 3.5);
  assert.equal(leerPeriodo("30"), 30);
  assert.equal(leerPeriodo("7"), 90);
});

test("embudo: de los que entraron en el periodo, hasta dónde llegaron (un rechazado cuenta hasta su última etapa)", () => {
  assert.equal(E.entraron, 3);
  const llegaron = Object.fromEntries(E.llegaron.map((x) => [x.etapa, x.n]));
  assert.equal(llegaron.prospecto, 3);
  assert.equal(llegaron.solicitud, 3); // C saltó a Análisis: cuenta como que pasó Solicitud.
  assert.equal(llegaron.analisis, 3);
  assert.equal(llegaron.comite, 2);
  assert.equal(llegaron.dispersado, 1);
});

test("tiempos: mediana de días en cada etapa, de estancias que terminaron en el periodo", () => {
  const t = Object.fromEntries(E.tiempos.map((x) => [x.etapa, x]));
  assert.deepEqual(t.prospecto, { etapa: "prospecto", mediana: 5, n: 3 }); // A 4, B 10, C 5 (D terminó en agosto).
  assert.deepEqual(t.solicitud, { etapa: "solicitud", mediana: 18.5, n: 2 }); // A 20, B 17.
});

test("dispersados, rechazados, abiertos y atorados", () => {
  assert.deepEqual(E.dispersados, { n: 1, monto: 2_000_000 });
  assert.equal(E.rechazados, 1);
  const abiertos = Object.fromEntries(E.abiertos.map((x) => [x.etapa, x]));
  assert.deepEqual(abiertos.comite, { etapa: "comite", n: 1, monto: 1_500_000 });
  assert.deepEqual(abiertos.solicitud, { etapa: "solicitud", n: 1, monto: 0 });
  assert.deepEqual(
    E.atorados.map((x) => [x.id, x.dias]),
    [
      ["D", 106],
      ["B", 23],
    ],
  );
});

test("por origen, responsable y broker", () => {
  assert.deepEqual(E.porOrigen[0], { clave: "broker", entraron: 1, dispersados: 1, montoDispersado: 2_000_000, abiertos: 0, montoAbierto: 0 });
  assert.deepEqual(E.porOrigen[1], { clave: "referido", entraron: 2, dispersados: 0, montoDispersado: 0, abiertos: 2, montoAbierto: 1_500_000 });
  assert.deepEqual(
    E.porResponsable.map((g) => g.clave),
    ["Ana", "Luis"],
  );
  assert.deepEqual(E.porBroker, [{ clave: "Broker Uno", entraron: 1, dispersados: 1, montoDispersado: 2_000_000, abiertos: 0, montoAbierto: 0 }]);
});
