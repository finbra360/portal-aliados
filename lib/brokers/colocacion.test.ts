import { test } from "node:test";
import assert from "node:assert/strict";
import {
  armarRanking,
  calcularStats,
  claveColocacion,
  normalizarFecha,
  normalizarMonto,
  normalizarPagado,
  normalizarPct,
  revisarColocacion,
  type Colocacion,
} from "./colocacion.ts";

const op = (id: number, brokerId: string, fecha: string, monto: number, extra: Partial<Colocacion> = {}): Colocacion => ({
  id,
  brokerId,
  fecha,
  monto,
  comisionAperturaPct: 5,
  pagadoTotalidad: false,
  referencia: null,
  ...extra,
});

test("stats: igual que el nodo de n8n (total, por mes ascendente, operaciones de la más reciente)", () => {
  const s = calcularStats([op(1, "B001", "2026-06-15", 850000), op(2, "B001", "2026-07-02", 500000, { comisionAperturaPct: null, pagadoTotalidad: true }), op(3, "B001", "2026-06-20", 150000)]);
  assert.equal(s.totalHistorico, 1500000);
  assert.equal(s.creditosCount, 3);
  assert.deepEqual(s.porMes, [{ mes: "Jun", anio: 2026, monto: 1000000 }, { mes: "Jul", anio: 2026, monto: 500000 }]);
  assert.deepEqual(s.operaciones.map((o) => o.fecha), ["2026-07-02", "2026-06-20", "2026-06-15"]);
  assert.equal(s.operaciones[0].comisionAperturaPct, undefined, "sin % capturado queda undefined, como con el Sheet");
  assert.equal(s.operaciones[0].pagadoTotalidad, true);
  assert.deepEqual(calcularStats([]), { totalHistorico: 0, creditosCount: 0, porMes: [], operaciones: [] });
});

test("ranking: solo brokers con colocación, por monto, con nombre de la tabla", () => {
  const r = armarRanking([op(1, "FAPBR001", "2026-06-01", 100), op(2, "FAPBR002", "2026-06-01", 300), op(3, "FAPBR001", "2026-06-02", 101)], new Map([["FAPBR002", "Dos"]]));
  assert.deepEqual(r, [
    { brokerId: "FAPBR002", nombre: "Dos", totalColocado: 300, numOperaciones: 1, ticketPromedio: 300 },
    { brokerId: "FAPBR001", nombre: "FAPBR001", totalColocado: 201, numOperaciones: 2, ticketPromedio: 101 },
  ]);
});

test("normalizar valores del archivo", () => {
  assert.equal(normalizarFecha("2026-06-15"), "2026-06-15");
  assert.equal(normalizarFecha("15/06/2026"), "2026-06-15");
  assert.equal(normalizarFecha("5-6-2026"), "2026-06-05");
  assert.equal(normalizarFecha("31/02/2026"), null);
  assert.equal(normalizarFecha("06/15/2026"), null, "mes 15 no existe: día primero");
  assert.equal(normalizarMonto("$850,000.00"), 850000);
  assert.equal(normalizarMonto("1 200 000"), 1200000);
  assert.equal(normalizarMonto("0"), null);
  assert.equal(normalizarMonto("abc"), null);
  assert.equal(normalizarPct("5"), 5);
  assert.equal(normalizarPct("4.5 %"), 4.5);
  assert.equal(normalizarPct(""), null);
  assert.equal(normalizarPct("cinco"), "error");
  assert.equal(normalizarPagado("Sí"), true);
  assert.equal(normalizarPagado(""), false);
  assert.equal(normalizarPagado("tal vez"), "error");
});

test("revisar la carga: nuevos, ya guardados, brokers inexistentes y errores", () => {
  const brokers = new Set(["FAPBR001", "FAPBR002"]);
  const guardadas = [claveColocacion({ brokerId: "FAPBR001", fecha: "2026-06-15", monto: 850000, referencia: null })];
  const r = revisarColocacion(
    [
      "ID Broker,Fecha,Monto MXN,Comisión Apertura %,Pagado en su totalidad",
      'FAPBR001,2026-06-15,"$850,000.00",5,', // ya guardada
      'FAPBR001,2026-06-15,"$850,000.00",5,', // otra igual: nueva
      "fapbr002,16/06/2026,500000,4.5,Sí",
      "FAPBR099,2026-06-16,100000,5,",
      "FAPBR001,2099-01-01,100000,5,",
      "FAPBR001,2026-06-16,cien,5,",
    ].join("\n"),
    brokers,
    guardadas,
    "2026-10-15",
  );
  assert.ok("filas" in r);
  assert.deepEqual(
    r.filas.map((f) => `${f.fila}:${f.estado}:${f.detalle ?? ""}`),
    [
      "2:existe:",
      "3:nuevo:",
      "4:nuevo:",
      "5:error:El broker FAPBR099 no está dado de alta",
      "6:error:La fecha no puede ser futura",
      "7:error:El monto no es válido",
    ],
  );
  assert.deepEqual(
    { id: r.filas[2].brokerId, fecha: r.filas[2].fecha, pct: r.filas[2].comisionAperturaPct, pagado: r.filas[2].pagadoTotalidad },
    { id: "FAPBR002", fecha: "2026-06-16", pct: 4.5, pagado: true },
  );
  assert.match((revisarColocacion("Broker,Fecha\nx,y", brokers, [], "2026-10-15") as { error: string }).error, /ID Broker.*Fecha.*Monto/);
});
