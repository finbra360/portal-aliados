import { test } from "node:test";
import assert from "node:assert/strict";
import { deflateRawSync, inflateRawSync } from "node:zlib";
import { leerXlsx } from "./xlsx.ts";
import { fechaDeCelda, leerEstadoClientes, montoDeCelda, validarCreditosHistoricos } from "./siac-historico.ts";

/** Un zip mínimo (sin CRC, que el lector no revisa) con los archivos dados, comprimidos. */
function zip(archivos: Record<string, string>): Uint8Array {
  const enc = new TextEncoder();
  const locales: Uint8Array[] = [];
  const centrales: Uint8Array[] = [];
  let offset = 0;
  for (const [nombre, contenido] of Object.entries(archivos)) {
    const n = enc.encode(nombre);
    const datos = deflateRawSync(enc.encode(contenido));
    const local = new Uint8Array(30 + n.length + datos.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(8, 8, true);
    lv.setUint32(18, datos.length, true);
    lv.setUint16(26, n.length, true);
    local.set(n, 30);
    local.set(datos, 30 + n.length);
    const central = new Uint8Array(46 + n.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(10, 8, true);
    cv.setUint32(20, datos.length, true);
    cv.setUint16(28, n.length, true);
    cv.setUint32(42, offset, true);
    central.set(n, 46);
    locales.push(local);
    centrales.push(central);
    offset += local.length;
  }
  const tamCentral = centrales.reduce((s, c) => s + c.length, 0);
  const fin = new Uint8Array(22);
  const fv = new DataView(fin.buffer);
  fv.setUint32(0, 0x06054b50, true);
  fv.setUint16(8, centrales.length, true);
  fv.setUint16(10, centrales.length, true);
  fv.setUint32(12, tamCentral, true);
  fv.setUint32(16, offset, true);
  const total = new Uint8Array(offset + tamCentral + 22);
  let p = 0;
  for (const x of [...locales, ...centrales, fin]) {
    total.set(x, p);
    p += x.length;
  }
  return total;
}

const inflar = async (d: Uint8Array) => new Uint8Array(inflateRawSync(d));

test("xlsx: cadenas compartidas, en línea, números y prefijos de espacio de nombres", async () => {
  const bytes = zip({
    "[Content_Types].xml": "<Types/>",
    "xl/sharedStrings.xml": `<sst><si><t>No. de Crédito</t></si><si><r><t>Ferre</t></r><r><t xml:space="preserve">tería &amp; Cía</t></r></si></sst>`,
    "xl/worksheets/sheet1.xml": `<x:worksheet><x:sheetData><x:row r="1"><x:c r="A1" t="s"><x:v>0</x:v></x:c><x:c r="C1" t="inlineStr"><x:is><x:t>Monto</x:t></x:is></x:c></x:row><x:row r="2"><x:c r="A2" t="s"><x:v>1</x:v></x:c><x:c r="B2"/><x:c r="C2"><x:v>1500000.5</x:v></x:c></x:row></x:sheetData></x:worksheet>`,
  });
  assert.deepEqual(await leerXlsx(bytes, inflar), [
    ["No. de Crédito", "", "Monto"],
    ["Ferretería & Cía", "", "1500000.5"],
  ]);
  await assert.rejects(leerXlsx(new TextEncoder().encode("no soy un zip, soy un csv;con;columnas"), inflar), /no es un Excel/);
});

test("celdas: fechas de Excel o texto y montos", () => {
  assert.equal(fechaDeCelda("44845"), "2022-10-11");
  assert.equal(fechaDeCelda("46344.75"), "2026-11-18");
  assert.equal(fechaDeCelda("05/03/2025"), "2025-03-05");
  assert.equal(fechaDeCelda("2025-03-05"), "2025-03-05");
  assert.equal(fechaDeCelda(""), null);
  assert.equal(fechaDeCelda("31/02/2025"), "invalida");
  assert.equal(fechaDeCelda("ayer"), "invalida");
  assert.equal(montoDeCelda("$1,250,000.00"), 1_250_000);
  assert.equal(montoDeCelda(""), null);
  assert.ok(Number.isNaN(montoDeCelda("mucho")));
});

const ENCABEZADOS = [
  "Clave de Cliente", "Promotor", "Apellido paterno", "Apellido materno", "Nombre (s)", "Personalidad", "Teléfono", "RFC", "CURP", "No. de Crédito",
  "Tipo de contrato", "Monto", "Estado del crédito", "Fecha de otorgamiento", "Fecha de vencimiento", "Fecha de último pago", "Promotor",
];
const fila = (x: Partial<Record<string, string>>) => ENCABEZADOS.map((h, i) => (i === 16 ? "" : (x[h] ?? "")));

test("Estado de Clientes: toma solo lo necesario, arma el nombre y avisa errores", () => {
  const r = leerEstadoClientes([
    ["ESTADO DE CLIENTES"],
    ["FECHA AL", "26/11/2026"],
    ENCABEZADOS,
    fila({ "Clave de Cliente": "000000900", "Nombre (s)": "MUDANZAS FICTICIAS SA DE CV", Personalidad: "PERSONA MORAL", Teléfono: "5550000000", CURP: "XXXX", "No. de Crédito": "1234 A", Monto: "1500000", "Estado del crédito": "PAGADO", "Fecha de otorgamiento": "44845", "Fecha de vencimiento": "45575", RFC: "mfi200101ab1" }),
    fila({ "Clave de Cliente": "000000901", "Apellido paterno": "EJEMPLO", "Apellido materno": "FICTICIO", "Nombre (s)": "ROSA", "No. de Crédito": "1300", Monto: "600000.50", "Estado del crédito": "VIGENTE", "Fecha de otorgamiento": "01/02/2025", "Fecha de último pago": "" }),
    fila({}),
    fila({ "Clave de Cliente": "000000902", "Nombre (s)": "SIN MONTO", "No. de Crédito": "1301", Monto: "mucho", "Fecha de otorgamiento": "44845" }),
    fila({ "Clave de Cliente": "000000903", "Nombre (s)": "REPETIDO", "No. de Crédito": "1234  a", Monto: "1", "Fecha de otorgamiento": "44845" }),
  ]);
  assert.deepEqual(r.faltan, []);
  assert.deepEqual(r.creditos, [
    { noCredito: "1234 A", numeroCliente: "000000900", nombre: "MUDANZAS FICTICIAS SA DE CV", rfc: "MFI200101AB1", personalidad: "PERSONA MORAL", tipoContrato: null, monto: 1_500_000, otorgado: "2022-10-11", vence: "2024-10-10", ultimoPago: null, estado: "PAGADO" },
    { noCredito: "1300", numeroCliente: "000000901", nombre: "ROSA EJEMPLO FICTICIO", rfc: null, personalidad: null, tipoContrato: null, monto: 600_000.5, otorgado: "2025-02-01", vence: null, ultimoPago: null, estado: "VIGENTE" },
  ]);
  assert.deepEqual(r.errores, ["Renglón 7 (crédito 1301): el monto no es un número.", "Renglón 8 (crédito 1234 A): el crédito viene repetido."]);
  // Ningún dato de contacto se cuela.
  assert.ok(!JSON.stringify(r.creditos).includes("5550000000"));

  assert.deepEqual(leerEstadoClientes([["Cliente", "Monto"], ["x", "1"]]).faltan, ["No. de Crédito", "Clave de Cliente", "Nombre (s)", "Monto", "Fecha de otorgamiento"]);
  assert.deepEqual(leerEstadoClientes([["No. de Crédito", "Monto"]]).faltan, ["Clave de Cliente", "Nombre (s)", "Fecha de otorgamiento"]);
});

test("validar lo que manda el navegador", () => {
  const ok = { noCredito: "1", numeroCliente: "9", nombre: "X", rfc: null, personalidad: null, tipoContrato: null, monto: 10, otorgado: "2025-01-01", vence: null, ultimoPago: null, estado: "PAGADO" };
  assert.equal(validarCreditosHistoricos([ok]).ok, true);
  assert.equal(validarCreditosHistoricos([]).ok, false);
  assert.equal(validarCreditosHistoricos([{ ...ok, otorgado: "1 de enero" }]).ok, false);
  assert.equal(validarCreditosHistoricos([{ ...ok, monto: "10" }]).ok, false);
  assert.equal(validarCreditosHistoricos([ok, ok]).ok, false);
});
