import test from "node:test";
import assert from "node:assert/strict";
import { buscarPago, calcCommissionLine, estatusDeLinea, totalesPorEstatus, type PagoRegistrado } from "./commissions.ts";
import type { OperacionFondeada } from "./n8n.ts";

const op = (o: Partial<OperacionFondeada> = {}): OperacionFondeada => ({
  id: 1,
  fecha: "2026-10-05",
  monto: 100000,
  comisionAperturaPct: 5,
  pagadoTotalidad: false,
  ...o,
});
const pago = (p: Partial<PagoRegistrado> = {}): PagoRegistrado => ({
  colocacionId: 1,
  operacionFecha: "2026-10-05",
  operacionMonto: 100000,
  estatus: "generada",
  fechaPago: null,
  ...p,
});

test("dos operaciones del mismo día se distinguen por su ID", () => {
  const a = op({ id: 1 });
  const b = op({ id: 2 });
  const pagos = [pago({ colocacionId: 2, estatus: "pagada" })];
  assert.equal(buscarPago(pagos, a), undefined);
  assert.equal(buscarPago(pagos, b)?.estatus, "pagada");
});

test("un pago antiguo sin ID se liga por fecha y monto", () => {
  const pagos = [pago({ colocacionId: null, estatus: "aprobada" })];
  assert.equal(buscarPago(pagos, op())?.estatus, "aprobada");
  assert.equal(buscarPago(pagos, op({ monto: 90000 })), undefined);
});

test("un pago con ID de otra operación no se ofrece por fecha y monto", () => {
  assert.equal(buscarPago([pago({ colocacionId: 9 })], op()), undefined);
});

test("estatus: sin % de apertura no hay comisión; sin pago registrado es generada", () => {
  assert.equal(estatusDeLinea(calcCommissionLine(op({ comisionAperturaPct: undefined })), pago({ estatus: "pagada" })), "sin_definir");
  assert.equal(estatusDeLinea(calcCommissionLine(op()), undefined), "generada");
  assert.equal(estatusDeLinea(calcCommissionLine(op()), pago({ estatus: "pagada" })), "pagada");
});

test("totales: por pagar suma generada y aprobada, pagado solo lo pagado, sin definir no cuenta", () => {
  const l = (o: Partial<OperacionFondeada>) => calcCommissionLine(op(o)); // 5% de 100,000 → 2,000
  const t = totalesPorEstatus([
    { line: l({}), estatus: "generada" },
    { line: l({}), estatus: "aprobada" },
    { line: l({ pagadoTotalidad: true }), estatus: "pagada" }, // 2,000 + 1,000 de bono
    { line: l({ comisionAperturaPct: undefined }), estatus: "sin_definir" },
  ]);
  assert.deepEqual(t, { porPagar: 4000, pagado: 3000 });
});
