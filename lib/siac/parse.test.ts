import { test } from "node:test";
import assert from "node:assert/strict";
import { parseAsmxJson, siacDate, toSnapshotValues, SiacParseError } from "./parse.ts";
import type { ConsultarSaldoCreditoResponse } from "./types.ts";

// Respuesta con la forma real de ConsultarSaldoCredito; montos y nombre ficticios.
const saldo: ConsultarSaldoCreditoResponse = {
  Detalle: "CORRECTO",
  Generales: { NoControl: "9999 R", IDCliente: "000000999", NombreCliente: "CLIENTE FICTICIO & HIJOS", FechaCalculo: "2026-09-28T00:00:00" },
  SaldoVigente: { saldoVigente: 0, CapitalVigente: 0, IVACapitalVigente: 0, InteresesVigentes: 0, IVAInteresesVigentes: 0, ComisionesFuturas: 0, IVAComisionesFuturas: 0 },
  SaldoVencido: {
    saldoVencido: 160047.64, CapitalVencido: 149160.33, IVACapitalVencido: 0, InteresesVencidos: 4880.86, IVAInteresesVencidos: 0,
    InteresesMoratorios: 1180.85, IVAInteresesMoratorios: 0, ComisionesVencidas: 4160, IVAComisionesVencidas: 665.6,
  },
  Totales: { SaldoActual: 160047.64, TotalPagar: 160047.64, SaldoGlobal: 160047.64, CAT: "62%" },
  Sumatorias: { Ministraciones: 1800000, Pagos: 2223457.04, Comisiones: 4825.6, Condonaciones: 0, Quitas: 0, Castigos: 0 },
};

const envolver = (json: string) =>
  `<?xml version="1.0" encoding="utf-8"?>\r\n<string xmlns="http://tempuri.org/">${json
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")}</string>`;

test("desenvuelve el JSON que SIAC manda dentro del XML", () => {
  const r = parseAsmxJson<ConsultarSaldoCreditoResponse>(envolver(JSON.stringify(saldo)));
  assert.deepEqual(r, saldo);
  assert.equal(r.Generales.NombreCliente, "CLIENTE FICTICIO & HIJOS");
});

test("un &quot; literal dentro del texto no se convierte en comillas", () => {
  const r = parseAsmxJson<{ Detalle: string; x: string }>(envolver(JSON.stringify({ Detalle: "CORRECTO", x: "a &quot; b" })));
  assert.equal(r.x, "a &quot; b");
});

test("respuestas que no son el sobre de SIAC truenan con un error claro", () => {
  assert.throws(() => parseAsmxJson("<html>Server Error</html>"), SiacParseError);
  assert.throws(() => parseAsmxJson('<string xmlns="http://tempuri.org/">{no es json</string>'), SiacParseError);
});

test("fechas de SIAC a YYYY-MM-DD", () => {
  assert.equal(siacDate("2025-06-20T00:00:00"), "2025-06-20");
  assert.equal(siacDate(null), null);
  assert.equal(siacDate("basura"), null);
});

test("saldo a columnas de la foto", () => {
  const v = toSnapshotValues(saldo);
  assert.equal(v.saldoVencido, 160047.64);
  assert.equal(v.capitalVencido, 149160.33);
  assert.equal(v.ivaComisionesVencidas, 665.6);
  assert.equal(v.sumaPagos, 2223457.04);
  assert.equal(v.cat, "62%");
  assert.equal(v.fechaCalculoSiac, "2026-09-28");
});
