import { test } from "node:test";
import assert from "node:assert/strict";
import { buildQueue, type QueueClient } from "./queue.ts";
import { summarizeCollected, summarizePortfolio, type PhotoRow } from "./portfolio.ts";

const HOY = "2026-09-30";
const cliente = (over: Partial<QueueClient>): QueueClient => ({
  clientId: "c",
  cliente: "EMPRESA FICTICIA",
  numeroCliente: "000000900",
  creditos: [],
  totalVencido: 10_000,
  maxAntiguedad: 10,
  alertas: [],
  promesaVigente: null,
  ultimaGestion: "2026-09-29",
  telefonoValido: true,
  pausaHasta: null,
  etapaManual: null,
  ...over,
});

test("la cola ordena por nivel y, dentro del nivel, por monto vencido", () => {
  const q = buildQueue(
    [
      cliente({ clientId: "seguimiento", totalVencido: 90_000 }),
      cliente({ clientId: "promesa", alertas: ["promesa_incumplida"], totalVencido: 5_000 }),
      cliente({ clientId: "mensualidad", alertas: ["nueva_mensualidad_vencida"] }),
      cliente({ clientId: "atraso", maxAntiguedad: 75 }),
      cliente({ clientId: "nuevo-grande", alertas: ["entrada_mora"], totalVencido: 50_000 }),
      cliente({ clientId: "nuevo-chico", alertas: ["entrada_mora"], totalVencido: 3_000 }),
      cliente({ clientId: "olvidado", ultimaGestion: "2026-09-10" }),
    ],
    1000,
    HOY,
  );
  assert.deepEqual(q.map((i) => [i.clientId, i.nivel]), [
    ["promesa", 1],
    ["mensualidad", 2],
    ["atraso", 3],
    ["nuevo-grande", 4],
    ["nuevo-chico", 4],
    ["olvidado", 5],
    ["seguimiento", 6],
  ]);
  assert.equal(q[0].accion, "Llamar hoy y renegociar la fecha");
  assert.ok(q.find((i) => i.clientId === "olvidado")!.motivos.includes("Sin gestión desde hace 20 días"));
});

test("fuera de la cola: residuos bajo el umbral", () => {
  assert.equal(buildQueue([cliente({ totalVencido: 400 })], 1000, HOY).length, 0);
  assert.equal(buildQueue([cliente({ totalVencido: 400, alertas: ["promesa_incumplida"] })], 1000, HOY).length, 1, "salvo que incumpliera una promesa");
});

test("en espera: promesa vigente o pausa; jurídico aparte", () => {
  const q = buildQueue(
    [
      cliente({ clientId: "promete", promesaVigente: { fechaCompromiso: "2026-10-02", monto: 5000 } }),
      cliente({ clientId: "promesa-vencida", promesaVigente: { fechaCompromiso: "2026-09-28", monto: 5000 } }),
      cliente({ clientId: "pausa", pausaHasta: "2026-10-15" }),
      cliente({ clientId: "pausa-vencida", pausaHasta: "2026-09-01" }),
      cliente({ clientId: "juridico", etapaManual: "juridico" }),
    ],
    1000,
    HOY,
  );
  const lugar = Object.fromEntries(q.map((i) => [i.clientId, i.lugar]));
  assert.deepEqual(lugar, { "promesa-vencida": "cola", "pausa-vencida": "cola", promete: "espera", pausa: "espera", juridico: "juridico" });
  assert.equal(q.find((i) => i.clientId === "promete")!.motivos[0], "Prometió pagar $5,000.00 el 2 oct 2026");
});

test("sin teléfono válido: se avisa y la acción es por llamada", () => {
  const [i] = buildQueue([cliente({ telefonoValido: false })], 1000, HOY);
  assert.ok(i.motivos.includes("Sin teléfono válido para WhatsApp: corregir en SIAC"));
  assert.match(i.accion, /por llamada/);
});

const fila = (over: Partial<PhotoRow>): PhotoRow => ({
  creditId: "x",
  clientId: "c",
  cliente: "EMPRESA FICTICIA",
  noCredito: "1",
  montoCredito: 100_000,
  antiguedad: 0,
  totalVencido: 0,
  interesesMoratorios: 0,
  totalAdeudo: 50_000,
  totalGlobal: 50_000,
  proximoVencimiento: null,
  ...over,
});

test("resumen de cartera: totales, mora por cliente, PAR y aging", () => {
  const s = summarizePortfolio(
    [
      fila({ creditId: "a", clientId: "c1", antiguedad: 0, totalAdeudo: 100_000, proximoVencimiento: "2026-10-05" }),
      fila({ creditId: "b", clientId: "c1", antiguedad: 5, totalVencido: 600, totalAdeudo: 50_000 }),
      fila({ creditId: "c", clientId: "c2", antiguedad: 45, totalVencido: 20_000, interesesMoratorios: 900, totalAdeudo: 30_000, proximoVencimiento: "2026-10-20" }),
      fila({ creditId: "d", clientId: "c3", antiguedad: 95, totalVencido: 15_000, totalAdeudo: 20_000, proximoVencimiento: "1999-01-01" }),
    ],
    1000,
    HOY,
  );
  assert.equal(s.creditos, 4);
  assert.equal(s.clientes, 3);
  assert.equal(s.colocado, 400_000);
  assert.equal(s.adeudo, 200_000);
  assert.equal(s.vencido, 35_600);
  assert.equal(s.clientesEnMora, 2, "c1 tiene 600 vencidos: residuo");
  assert.equal(s.vencidoEnMora, 35_000);
  assert.equal(s.par30, 0.25);
  assert.equal(s.par90, 0.1);
  assert.deepEqual(s.aging.map((a) => [a.bucket, a.creditos]), [["al_corriente", 1], ["1-7", 1], ["8-30", 0], ["31-60", 1], ["61-90", 0], ["90+", 1]]);
  assert.deepEqual([s.proximos.en7, s.proximos.en15, s.proximos.en30], [1, 1, 2]);
  assert.equal(s.top[0].clientId, "c1");
});

test("resumen sin cartera no divide entre cero", () => {
  const s = summarizePortfolio([], 1000, HOY);
  assert.equal(s.pctVencido, null);
  assert.equal(s.par30, null);
});

test("cobrado en el día, la semana y el mes", () => {
  const c = summarizeCollected(
    [
      { fecha: "2026-09-30", monto: 1000 },
      { fecha: "2026-09-26", monto: 2000 },
      { fecha: "2026-09-10", monto: 4000 },
      { fecha: "2026-08-31", monto: 8000 },
      { fecha: "2026-10-01", monto: 16000 },
    ],
    HOY,
  );
  assert.deepEqual(c, { hoy: { monto: 1000, pagos: 1 }, semana: { monto: 3000, pagos: 2 }, mes: { monto: 7000, pagos: 3 } });
});
