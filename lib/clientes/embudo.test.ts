import { test } from "node:test";
import assert from "node:assert/strict";
import { calcularEmbudo, fechaMx, leerPeriodo, mediana, percentil, porTrimestre, type CambioEmbudo, type NegocioEmbudo } from "./embudo.ts";

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
  n({ id: "A", etapa: "dispersado", etapaDesde: "2026-11-10T15:00:00.000Z", monto: 2_000_000, broker: "Broker Uno", origen: "broker", producto: "pyme" }),
  n({ id: "B", creadoAt: "2026-10-05T15:00:00.000Z", etapa: "comite", etapaDesde: "2026-11-01T15:00:00.000Z", monto: 1_500_000, responsable: "Luis", producto: "pyme" }),
  n({ id: "C", creadoAt: "2026-10-20T15:00:00.000Z", etapa: "rechazado", etapaDesde: "2026-11-05T15:00:00.000Z", rechazoMotivo: "capacidad", rechazoPor: "finbra" }),
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

test("mediana, percentil, fecha de México y periodo", () => {
  assert.equal(mediana([]), null);
  assert.equal(mediana([5, 1, 3]), 3);
  assert.equal(mediana([4, 1, 3, 10]), 3.5);
  assert.equal(percentil([], 75), null);
  assert.equal(percentil([1, 2, 3, 4, 5], 75), 4);
  assert.equal(percentil([10, 20], 75), 17.5);
  assert.equal(fechaMx("2026-10-01T03:00:00.000Z"), "2026-09-30"); // 9 pm del 30-sep en México.
  assert.equal(leerPeriodo("30"), 30);
  assert.equal(leerPeriodo("0"), 0);
  assert.equal(leerPeriodo("7"), 90);
});

test("embudo: de los que entraron en el periodo, hasta dónde llegaron y cuántos ya se dispersaron", () => {
  assert.equal(E.entraron, 3);
  const llegaron = Object.fromEntries(E.llegaron.map((x) => [x.etapa, x.n]));
  assert.equal(llegaron.prospecto, 3);
  assert.equal(llegaron.solicitud, 3); // C saltó a Análisis: cuenta como que pasó Solicitud.
  assert.equal(llegaron.analisis, 3);
  assert.equal(llegaron.comite, 2);
  assert.equal(llegaron.dispersado, 1);
  assert.equal(E.conversion, 1 / 3);
});

test("tiempos: mediana, promedio y percentil 75 de días en cada etapa", () => {
  const t = Object.fromEntries(E.tiempos.map((x) => [x.etapa, x]));
  assert.deepEqual(t.prospecto, { etapa: "prospecto", mediana: 5, promedio: 6.3, p75: 7.5, n: 3 }); // A 4, B 10, C 5.
  assert.deepEqual(t.solicitud, { etapa: "solicitud", mediana: 18.5, promedio: 18.5, p75: 19.25, n: 2 }); // A 20, B 17.
});

test("dispersados con ticket y ciclo; rechazos por quién y motivo; abiertos y atorados", () => {
  assert.deepEqual(E.dispersados, { n: 1, monto: 2_000_000, ticket: 2_000_000, ciclo: 40, cicloP75: 40 });
  assert.equal(E.rechazados, 1);
  assert.deepEqual(E.rechazos, { finbra: 1, cliente: 0, sinDato: 0, motivos: [{ clave: "capacidad", label: "Capacidad de pago insuficiente", n: 1 }] });
  assert.equal(E.pospuestos, 0);
  const abiertos = Object.fromEntries(E.abiertos.map((x) => [x.etapa, x]));
  assert.deepEqual(abiertos.comite, { etapa: "comite", n: 1, monto: 1_500_000 });
  assert.deepEqual(
    E.atorados.map((x) => [x.id, x.dias]),
    [
      ["D", 106],
      ["B", 23],
    ],
  );
});

test("por origen, responsable, broker y producto, con ticket y conversión", () => {
  assert.deepEqual(E.porOrigen[0], { clave: "broker", entraron: 1, dispersados: 1, montoDispersado: 2_000_000, ticket: 2_000_000, conversion: 1, abiertos: 0, montoAbierto: 0 });
  assert.deepEqual(E.porOrigen[1], { clave: "referido", entraron: 2, dispersados: 0, montoDispersado: 0, ticket: null, conversion: 0, abiertos: 2, montoAbierto: 1_500_000 });
  assert.deepEqual(
    E.porResponsable.map((g) => g.clave),
    ["Ana", "Luis"],
  );
  assert.deepEqual(E.porBroker.map((g) => g.clave), ["Broker Uno"]);
  assert.deepEqual(
    E.porProducto.map((g) => [g.clave, g.entraron]),
    [
      ["Crédito PyME", 2],
      ["Sin producto", 1],
    ],
  );
});

test("probabilidades: con los cerrados, la parte que se dispersó desde cada etapa; con pocos, sin dato", () => {
  // 6 cerrados que pasaron por Solicitud: 3 dispersados → 50 %. A Comité llegaron 4, 3 dispersados → 75 %.
  const cerrados: NegocioEmbudo[] = [];
  const hist: CambioEmbudo[] = [];
  const caso = (id: string, ruta: NegocioEmbudo["etapa"][], final: NegocioEmbudo["etapa"]) => {
    cerrados.push(n({ id, etapa: final }));
    ruta.forEach((a, i) => hist.push(c(id, i ? ruta[i - 1] : null, a, `2026-01-${String(10 + i).padStart(2, "0")}`)));
  };
  for (const id of ["g1", "g2", "g3"]) caso(id, ["prospecto", "solicitud", "comite", "dispersado"], "dispersado");
  caso("r1", ["prospecto", "solicitud", "comite", "rechazado"], "rechazado");
  caso("r2", ["prospecto", "solicitud", "rechazado"], "rechazado");
  caso("p1", ["prospecto", "solicitud", "pospuesto"], "pospuesto");
  const abierto = n({ id: "x", etapa: "comite", monto: 1_000_000 });
  const r = calcularEmbudo({ negocios: [...cerrados, abierto], cambios: hist, desde: "2026-01-01T00:00:00.000Z", hasta: "2026-12-31T00:00:00.000Z", hoy: "2026-11-24", diasAtorado: 0 });
  const pr = Object.fromEntries(r.probabilidades.map((x) => [x.etapa, x]));
  assert.deepEqual(pr.solicitud, { etapa: "solicitud", base: 6, dispersados: 3, p: 0.5 });
  assert.deepEqual(pr.comite, { etapa: "comite", base: 4, dispersados: 3, p: null }); // menos de 5 cerrados
  assert.deepEqual(r.pronostico, { monto: 0, cubierto: 0 }); // Comité sin probabilidad: no entra al pronóstico.
  const r2 = calcularEmbudo({ negocios: [...cerrados, n({ id: "y", etapa: "solicitud", monto: 2_000_000 })], cambios: hist, desde: "2026-01-01T00:00:00.000Z", hasta: "2026-12-31T00:00:00.000Z", hoy: "2026-11-24", diasAtorado: 0 });
  assert.deepEqual(r2.pronostico, { monto: 1_000_000, cubierto: 2_000_000 });
});

test("trimestres: cada evento en el trimestre de su fecha; variación, conversión y el que va en curso", () => {
  const t = porTrimestre({ negocios: NEGOCIOS, cambios: CAMBIOS, hoy: "2026-11-24", cuantos: 3 });
  assert.deepEqual(
    t.map((x) => [x.etiqueta, x.desde, x.hasta, x.enCurso]),
    [
      ["Q2 2026", "2026-04-01", "2026-07-01", false],
      ["Q3 2026", "2026-07-01", "2026-10-01", false],
      ["Q4 2026", "2026-10-01", "2027-01-01", true],
    ],
  );
  const q3 = t[1];
  const q4 = t[2];
  assert.equal(q3.entraron, 1); // D, en agosto.
  assert.equal(q3.dispersados, 0);
  assert.equal(q3.conversion, 0);
  assert.equal(q4.entraron, 3);
  assert.deepEqual([q4.dispersados, q4.montoDispersado, q4.ticket, q4.ciclo, q4.rechazados], [1, 2_000_000, 2_000_000, 40, 1]);
  assert.equal(q4.conversion, 1 / 3);
  assert.equal(q4.variacion, null); // Q3 no dispersó nada.
  // Cambio de año.
  assert.deepEqual(
    porTrimestre({ negocios: [], cambios: [], hoy: "2026-02-10", cuantos: 2 }).map((x) => x.clave),
    ["2025-Q4", "2026-Q1"],
  );
});

test("importados de HubSpot: no cuentan como tiempo en la etapa ni como paso por etapas que no se ven", () => {
  // G: ganado traído de HubSpot (alta → dispersado, importado). R: rechazado nativo que pasó por Solicitud.
  const negocios = [
    n({ id: "G", creadoAt: "2025-01-01T15:00:00.000Z", etapa: "dispersado", etapaDesde: "2025-06-01T15:00:00.000Z" }),
    ...["R1", "R2", "R3", "R4", "R5"].map((id) => n({ id, creadoAt: "2026-01-01T15:00:00.000Z", etapa: "rechazado" })),
  ];
  const cambios: CambioEmbudo[] = [
    c("G", null, "prospecto", "2025-01-01"),
    { ...c("G", "prospecto", "dispersado", "2025-06-01"), importado: true },
    ...["R1", "R2", "R3", "R4", "R5"].flatMap((id) => [c(id, null, "prospecto", "2026-01-01"), c(id, "prospecto", "solicitud", "2026-01-05"), c(id, "solicitud", "rechazado", "2026-01-20")]),
  ];
  const r = calcularEmbudo({ negocios, cambios, desde: "2000-01-01T00:00:00.000Z", hasta: "2026-12-31T00:00:00.000Z", hoy: "2026-11-24", diasAtorado: 0 });
  const pr = Object.fromEntries(r.probabilidades.map((x) => [x.etapa, x]));
  assert.deepEqual(pr.prospecto, { etapa: "prospecto", base: 6, dispersados: 1, p: 1 / 6 });
  // A Solicitud solo pasaron los 5 rechazados: el ganado importado no cuenta ahí.
  assert.deepEqual(pr.solicitud, { etapa: "solicitud", base: 5, dispersados: 0, p: 0 });
  // Prospecto: los 4 días de los rechazados; los 151 del ganado importado no cuentan.
  const t = Object.fromEntries(r.tiempos.map((x) => [x.etapa, x]));
  assert.equal(t.prospecto.n, 5);
  assert.equal(t.prospecto.mediana, 4);
});
