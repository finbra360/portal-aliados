import { test } from "node:test";
import assert from "node:assert/strict";
import { buildCreditList, plazoTerminado, type CreditListRow } from "./credits-list.ts";

const HOY = "2026-11-04";

const fila = (over: Partial<CreditListRow>): CreditListRow => ({
  creditId: "x",
  clientId: "c",
  cliente: "EMPRESA FICTICIA",
  numeroCliente: "000000100",
  noCredito: "1000",
  tipoCredito: "SIMPLE",
  montoCredito: 500_000,
  fechaMinistracion: "2025-01-15",
  enListado: true,
  etapaManual: null,
  adeudo: 300_000,
  vencido: 0,
  atraso: 0,
  proximoVencimiento: "2026-11-20",
  montoSiguiente: 20_000,
  vencimientos: 36,
  cubiertos: 10,
  vencidos: 0,
  ultimoPago: "2026-10-20",
  fechaTermino: "2028-01-15",
  promotor: null,
  ...over,
});

const ROWS = [
  fila({ creditId: "a", noCredito: "1010", cliente: "Transportes Norte", numeroCliente: "000000101", vencido: 80_000, atraso: 95, etapaManual: "juridico" }),
  fila({ creditId: "b", noCredito: "1008 R", cliente: "ÁGORA LOGÍSTICA", numeroCliente: "000000102", vencido: 40_000, atraso: 12, adeudo: 900_000 }),
  fila({ creditId: "c", noCredito: "1009", cliente: "Agro Occidente", numeroCliente: "000000103", proximoVencimiento: "2026-11-06" }),
  fila({ creditId: "d", noCredito: "999", cliente: "Clínica Centro", numeroCliente: "000000104", vencido: 300, atraso: 2, proximoVencimiento: "2026-11-05" }),
  fila({ creditId: "e", noCredito: "1001", cliente: "Liquidado SA", numeroCliente: "000000105", enListado: false, adeudo: null, vencido: null, atraso: null, proximoVencimiento: null }),
];

const ids = (opts: Parameters<typeof buildCreditList>[3]) => buildCreditList(ROWS, 1000, HOY, opts).items.map((i) => i.creditId);

test("filtros y conteos", () => {
  const r = buildCreditList(ROWS, 1000, HOY, { filtro: "activos", q: "" });
  assert.equal(r.total, 4, "los que salieron de SIAC no cuentan como activos");
  assert.deepEqual(r.conteos, { activos: 4, mora: 2, corriente: 2, proximos: 2, por_terminar: 0, extrajudicial: 0, juridico: 1, fuera: 1 });
  assert.deepEqual(ids({ filtro: "mora", q: "" }), ["b", "a"], "los $300 de la clínica son residuo, no mora");
  assert.deepEqual(ids({ filtro: "proximos", q: "" }), ["d", "c"], "al corriente (o con residuo) y pagan en 7 días o menos");
  assert.deepEqual(ids({ filtro: "fuera", q: "" }), ["e"]);
});

test("por omisión, por número de crédito en orden numérico", () => {
  assert.deepEqual(ids({ filtro: "activos", q: "" }), ["d", "b", "c", "a"], "999 < 1008 R < 1009 < 1010");
});

test("ordenar por cliente, montos, atraso y próximo pago", () => {
  assert.deepEqual(ids({ filtro: "activos", q: "", orden: "cliente" }), ["b", "c", "d", "a"], "sin importar acentos ni mayúsculas");
  assert.deepEqual(ids({ filtro: "activos", q: "", orden: "vencido" }), ["a", "b", "d", "c"]);
  assert.deepEqual(ids({ filtro: "activos", q: "", orden: "adeudo" }), ["b", "d", "c", "a"]);
  assert.deepEqual(ids({ filtro: "activos", q: "", orden: "atraso" }), ["a", "b", "d", "c"]);
  assert.deepEqual(ids({ filtro: "activos", q: "", orden: "proximo" }), ["d", "c", "b", "a"]);
});

test("búsqueda por cliente, número de crédito o número de cliente", () => {
  assert.deepEqual(ids({ filtro: "activos", q: "agora" }), ["b"]);
  assert.deepEqual(ids({ filtro: "activos", q: "1008 r" }), ["b"]);
  assert.deepEqual(ids({ filtro: "activos", q: "000000103" }), ["c"]);
  const r = buildCreditList(ROWS, 1000, HOY, { filtro: "mora", q: "norte" });
  assert.deepEqual(r.items.map((i) => i.creditId), ["a"]);
  assert.equal(r.conteos.activos, 1);
});

test("por terminar: fin del plazo dentro de la ventana, sin jurídico, extrajudicial ni reestructura", () => {
  const rows = [
    fila({ creditId: "t10", noCredito: "2010", fechaTermino: "2026-11-14" }), // 10 días
    fila({ creditId: "t45", noCredito: "2045", fechaTermino: "2026-12-19" }), // 45 días
    fila({ creditId: "t90", noCredito: "2090", fechaTermino: "2027-02-02" }), // 90 días: entra
    fila({ creditId: "t91", noCredito: "2091", fechaTermino: "2027-02-03" }), // 91 días: no
    fila({ creditId: "hoy", noCredito: "2000", fechaTermino: HOY }), // termina hoy: entra
    fila({ creditId: "paso", noCredito: "1999", fechaTermino: "2026-11-03" }), // ya pasó: no
    fila({ creditId: "jur", noCredito: "2011", fechaTermino: "2026-11-20", etapaManual: "juridico" }),
    fila({ creditId: "ext", noCredito: "2012", fechaTermino: "2026-11-20", etapaManual: "extrajudicial" }),
    fila({ creditId: "rees", noCredito: "2013", fechaTermino: "2026-11-20", etapaManual: "reestructura" }),
    fila({ creditId: "pau", noCredito: "2014", fechaTermino: "2026-11-20", etapaManual: "pausado" }), // pausa de cobranza: sí entra
    fila({ creditId: "sin", noCredito: "2015", fechaTermino: null }),
    fila({ creditId: "fuera", noCredito: "2016", fechaTermino: "2026-11-20", enListado: false }),
  ];
  const ver = (ventana?: 30 | 60 | 90) =>
    buildCreditList(rows, 1000, HOY, { filtro: "por_terminar", q: "", orden: "termino", ventana }).items.map((i) => i.creditId);
  assert.deepEqual(ver(), ["hoy", "t10", "pau", "t45", "t90"], "90 días por omisión, el que termina antes primero");
  assert.deepEqual(ver(30), ["hoy", "t10", "pau"]);
  assert.deepEqual(ver(60), ["hoy", "t10", "pau", "t45"]);
  const r = buildCreditList(rows, 1000, HOY, { filtro: "activos", q: "", ventana: 30 });
  assert.equal(r.conteos.por_terminar, 3, "el conteo usa la misma ventana");
  const dias = Object.fromEntries(r.items.map((i) => [i.creditId, i.diasParaTermino]));
  assert.equal(dias.t10, 10);
  assert.equal(dias.paso, -1);
  assert.equal(dias.sin, null);
});

test("ordenar por fin del plazo deja al final los que no traen fecha", () => {
  const rows = [fila({ creditId: "sin", fechaTermino: null }), fila({ creditId: "tarde", fechaTermino: "2029-01-01" }), fila({ creditId: "pronto", fechaTermino: "2027-01-01" })];
  assert.deepEqual(buildCreditList(rows, 1000, HOY, { filtro: "activos", q: "", orden: "termino" }).items.map((i) => i.creditId), ["pronto", "tarde", "sin"]);
});

test("plazo terminado: sin próxima fecha y con todas las mensualidades pagadas o vencidas", () => {
  assert.equal(plazoTerminado(fila({ proximoVencimiento: null, vencimientos: 12, cubiertos: 9, vencidos: 3 })), true);
  assert.equal(plazoTerminado(fila({ proximoVencimiento: null, vencimientos: 15, cubiertos: 14, vencidos: 1 })), true);
  assert.equal(plazoTerminado(fila({ proximoVencimiento: null, vencimientos: 12, cubiertos: 8, vencidos: 2 })), false, "faltan mensualidades: dato incompleto, no plazo terminado");
  assert.equal(plazoTerminado(fila({ proximoVencimiento: "2026-11-20" })), false);
  assert.equal(plazoTerminado(fila({ proximoVencimiento: null, vencimientos: null })), false);
  const [i] = buildCreditList([fila({ proximoVencimiento: null, vencimientos: 12, cubiertos: 12, vencidos: 0 })], 1000, HOY, { filtro: "activos", q: "" }).items;
  assert.equal(i.plazoTerminado, true);
});
