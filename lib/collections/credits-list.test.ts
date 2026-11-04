import { test } from "node:test";
import assert from "node:assert/strict";
import { buildCreditList, type CreditListRow } from "./credits-list.ts";

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
  assert.deepEqual(r.conteos, { activos: 4, mora: 2, corriente: 2, proximos: 2, juridico: 1, fuera: 1 });
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
