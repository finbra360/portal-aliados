import { test } from "node:test";
import assert from "node:assert/strict";
import { decodeEntities, parseAsmxJson, parseListado, parsePagos, siacDate, SiacParseError } from "./parse.ts";
import type { ListadoCobranzaItem, ListadoCobranzaResponse } from "./types.ts";

// Forma real de ListadoCobranzaJSON; nombres, teléfonos y montos ficticios.
const item = (over: { g?: object; k?: object; cr?: object; v?: object } = {}): ListadoCobranzaItem => ({
  InformacionGeneral: { NoCredito: "9001 R", NumeroCliente: "000000901", Cliente: "EMPRESA FICTICIA, S.A. DE C.V.", TipoCredito: "SIMPLE", Sucursal: null, NombrePromotor: "", ...over.g },
  CondicionesFinanciamientoCobranza: { Tasa: 24.5, MontoCredito: 500000.456, FechaMinistracion: "2025-06-20T00:00:00", FechaTerminoContrato: "2026-09-20T00:00:00", Vencimientos: 15, PlazoMeses: 15 },
  InformacionContacto: { TelefonoCliente: "55 1111 2222", Celular: "", CorreoCliente: "contacto@ejemplo.test", NombreAval: "AVAL FICTICIO", TelefonoAval: "5533334444", ...over.k },
  CobranzaRespuesta: {
    Antiguedad: 4, Atrasomaximo: 12, FechaUltimoPago: "2026-08-25T00:00:00", NumeroVecesMora: 2, VencimientosCubiertos: 14,
    VencimientosVencidos: 1, VencimientosPorVencer: 0, FrecuenciaPagos: "MENSUAL", DiasSinMovimiento: 35,
    ProximoVencimiento: "1800-01-01T00:00:00", MontoPorVencer: 0, ...over.cr,
  },
  Vencido: { InteresesMoratorios: 1180.851, IVAVencido: 665.6, TotalVencido: 160047.644, TotalAdeudo: 160047.64, TotalGlobal: 160047.64, ...over.v },
});

const envolver = (json: string) =>
  `<?xml version="1.0" encoding="utf-8"?>\r\n<string xmlns="http://tempuri.org/">${json
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")}</string>`;

test("desenvuelve el JSON que SIAC manda dentro del XML", () => {
  const r: ListadoCobranzaResponse = { Detalle: "CORRECTO", vListEntCredito: [{ Cobranza: [item()] }] };
  assert.deepEqual(parseAsmxJson(envolver(JSON.stringify(r))), r);
});

test("decodifica entidades numéricas como &#225;", () => {
  assert.equal(decodeEntities("Jos&#233; Mar&#237;a Garc&#xED;a &amp; Hijos"), "José María García & Hijos");
  const r = parseAsmxJson<{ Detalle: string; x: string }>(`<string xmlns="http://tempuri.org/">{&quot;Detalle&quot;:&quot;CORRECTO&quot;,&quot;x&quot;:&quot;Cr&#233;dito&quot;}</string>`);
  assert.equal(r.x, "Crédito");
});

test("un &quot; literal dentro del texto no se convierte en comillas", () => {
  const r = parseAsmxJson<{ Detalle: string; x: string }>(envolver(JSON.stringify({ Detalle: "CORRECTO", x: "a &quot; b" })));
  assert.equal(r.x, "a &quot; b");
});

test("respuestas que no son el sobre de SIAC truenan con un error claro", () => {
  assert.throws(() => parseAsmxJson("Falta el parámetro: Contenido"), SiacParseError);
  assert.throws(() => parseAsmxJson('<string xmlns="http://tempuri.org/">{no es json</string>'), SiacParseError);
});

test("fechas centinela de SIAC se guardan como vacías", () => {
  assert.equal(siacDate("2025-06-20T00:00:00"), "2025-06-20");
  assert.equal(siacDate("1800-01-01T00:00:00"), null, "ProximoVencimiento sin pagos futuros");
  assert.equal(siacDate("0001-01-01T00:00:00"), null, "FechaAlta no confiable");
  assert.equal(siacDate(null), null);
  assert.equal(siacDate("basura"), null);
});

test("listado a créditos limpios", () => {
  const r: ListadoCobranzaResponse = { Detalle: "CORRECTO", vListEntCredito: [{ Cobranza: [item()] }] };
  const { creditos, descartados } = parseListado(r);
  assert.equal(descartados.length, 0);
  const c = creditos[0];
  assert.equal(c.noCredito, "9001 R", "NoCredito es texto con sufijo");
  assert.equal(c.numeroCliente, "000000901");
  assert.equal(c.credito.fechaMinistracion, "2025-06-20");
  assert.equal(c.credito.montoCredito, 500000.46);
  assert.equal(c.credito.sucursal, null);
  assert.equal(c.credito.nombrePromotor, null, "vacío cuenta como null");
  assert.equal(c.credito.frecuenciaPagos, "MENSUAL");
  assert.equal(c.contacto.celular, null);
  assert.equal(c.contacto.telefonoCliente, "55 1111 2222");
  assert.equal(c.foto.antiguedad, 4);
  assert.equal(c.foto.proximoVencimiento, null);
  assert.equal(c.foto.fechaUltimoPago, "2026-08-25");
  assert.equal(c.foto.totalVencido, 160047.64, "redondeo a 2 decimales");
  assert.equal(c.foto.interesesMoratorios, 1180.85);
});

test("varios bloques, varios créditos por cliente y créditos sin identificar", () => {
  const r: ListadoCobranzaResponse = {
    Detalle: "CORRECTO",
    vListEntCredito: [
      { Cobranza: [item(), item({ g: { NoCredito: "9002 2D" } })] },
      { Cobranza: [item({ g: { NoCredito: "", NumeroCliente: "000000902" } })] },
      {},
    ],
  };
  const { creditos, descartados } = parseListado(r);
  assert.deepEqual(creditos.map((c) => c.noCredito), ["9001 R", "9002 2D"]);
  assert.equal(descartados.length, 1);
});

test("antigüedad negativa o vacía cuenta como al corriente", () => {
  const r: ListadoCobranzaResponse = { Detalle: "CORRECTO", vListEntCredito: [{ Cobranza: [item({ cr: { Antiguedad: null } }), item({ g: { NoCredito: "x" }, cr: { Antiguedad: -3 } })] }] };
  assert.deepEqual(parseListado(r).creditos.map((c) => c.foto.antiguedad), [0, 0]);
});

test("pagos de ConsultarPagos con llave estable aunque SIAC no dé un identificador", () => {
  const pago = (f: string, monto: number, captura = f) => ({
    Generales: { NoControl: "9001 R", IDCliente: "000000901", NombreCliente: "EMPRESA FICTICIA" },
    DetallePago: { FechaCaptura: `${captura}T00:00:00`, Monto: monto, FechaAplicacion: `${f}T00:00:00`, NoPago: 1, ConceptoPago: "TRANSFERENCIA ELECTRONICA", Comentario: "" },
  });
  const r = parsePagos({
    Detalle: "CORRECTO",
    ListadoPagos: [
      pago("2025-07-25", 158818.36),
      pago("2025-08-25", 158818.36),
      pago("2025-08-25", 158818.36), // idéntico al anterior
      pago("2025-09-25", 158818.36, "2025-09-29"), // capturado tarde
      pago("2025-10-25", 0),
    ],
  });
  assert.equal(r.length, 4, "sin el de monto 0");
  assert.deepEqual(r.map((p) => p.ocurrencia), [1, 1, 2, 1]);
  assert.equal(r[3].fechaAplicacion, "2025-09-25");
  assert.equal(r[3].fechaCaptura, "2025-09-29");
  assert.equal(r[0].concepto, "TRANSFERENCIA ELECTRONICA");
  assert.equal(r[0].comentario, null);
  assert.equal(parsePagos({ Detalle: "CORRECTO" }).length, 0);
});
