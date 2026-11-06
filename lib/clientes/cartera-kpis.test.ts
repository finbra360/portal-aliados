import { test } from "node:test";
import assert from "node:assert/strict";
import {
  calidadDeDatos,
  coberturaContacto,
  embudoRenovacion,
  finesDePlazo,
  originacionPorMes,
  porEjecutivo,
  type CreditoKpi,
  type EmpresaKpi,
} from "./cartera-kpis.ts";

const HOY = "2026-11-05";

const credito = (over: Partial<CreditoKpi>): CreditoKpi => ({ enListado: true, fechaTermino: null, montoCredito: 1_000_000, fechaMinistracion: null, ...over });
const empresa = (over: Partial<EmpresaKpi>): EmpresaKpi => ({
  empresaId: "e",
  creditosVigentes: 1,
  enMora: false,
  rfc: null,
  ejecutivoEmail: null,
  ejecutivoNombre: null,
  tienePrincipal: false,
  cuentaPago: false,
  whatsappValido: false,
  ultimoContacto: null,
  ...over,
});

test("fines de plazo: por ventana, solo vigentes y sin los que ya terminaron", () => {
  const r = finesDePlazo(
    [
      credito({ fechaTermino: "2026-11-05", montoCredito: 100 }), // hoy: 0 días
      credito({ fechaTermino: "2026-12-05", montoCredito: 200 }), // 30
      credito({ fechaTermino: "2026-12-06", montoCredito: 300 }), // 31
      credito({ fechaTermino: "2027-02-03", montoCredito: 400 }), // 90
      credito({ fechaTermino: "2027-02-04" }), // 91: fuera
      credito({ fechaTermino: "2026-11-01" }), // ya terminó
      credito({ fechaTermino: "2026-11-20", enListado: false }), // salió del listado
    ],
    HOY,
  );
  assert.deepEqual(r, [
    { desde: 0, hasta: 30, creditos: 2, monto: 300 },
    { desde: 31, hasta: 60, creditos: 1, monto: 300 },
    { desde: 61, hasta: 90, creditos: 1, monto: 400 },
  ]);
});

test("originación por mes: solo desde el mes de la primera foto; incluye los que ya salieron del listado", () => {
  const r = originacionPorMes(
    [
      credito({ fechaMinistracion: "2026-08-15" }), // antes de la primera foto: no se muestra
      credito({ fechaMinistracion: "2026-10-02", montoCredito: 500 }),
      credito({ fechaMinistracion: "2026-10-20", montoCredito: 700, enListado: false }),
      credito({ fechaMinistracion: "2026-11-01", montoCredito: 900 }),
    ],
    "2026-09-28",
    HOY,
  );
  assert.deepEqual(r, [
    { mes: "2026-09", creditos: 0, monto: 0 },
    { mes: "2026-10", creditos: 2, monto: 1200 },
    { mes: "2026-11", creditos: 1, monto: 900 },
  ]);
  assert.deepEqual(originacionPorMes([], null, HOY), []);
  // Cambio de año.
  assert.deepEqual(originacionPorMes([], "2026-12-10", "2027-01-02").map((m) => m.mes), ["2026-12", "2027-01"]);
});

test("calidad de datos y cobertura: solo empresas con crédito vigente", () => {
  const empresas = [
    empresa({ rfc: "AAA010101AA1", ejecutivoEmail: "a@x", tienePrincipal: true, cuentaPago: true, whatsappValido: true, ultimoContacto: "2026-10-01T15:00:00Z" }),
    empresa({ whatsappValido: true, ultimoContacto: "2026-08-01T15:00:00Z" }), // contacto hace más de 60 días
    empresa({ creditosVigentes: 0, rfc: "BBB010101BB1", ultimoContacto: "2026-11-01T15:00:00Z" }), // ex cliente: no cuenta
  ];
  const c = calidadDeDatos(empresas);
  assert.deepEqual(c.rfc, { n: 1, de: 2 });
  assert.deepEqual(c.whatsapp, { n: 2, de: 2 });
  assert.deepEqual(c.cuentaPago, { n: 1, de: 2 });
  assert.deepEqual(coberturaContacto(empresas, HOY), { n: 1, de: 2 });
});

test("embudo de renovación", () => {
  const e = embudoRenovacion([
    { estado: "abierta", montoReferencia: 100, abiertaEl: HOY },
    { estado: "interesado", montoReferencia: 200, abiertaEl: HOY },
    { estado: "ganada", montoReferencia: 999, abiertaEl: HOY },
    { estado: "descartada", montoReferencia: null, abiertaEl: HOY },
  ]);
  assert.deepEqual(e, { nuevas: 1, enContacto: 0, interesados: 1, ganadas: 1, descartadas: 1, cerradas: 0, total: 4, montoAbierto: 300 });
});

test("por ejecutivo: clientes, mora, contacto y tareas; «Sin ejecutivo» al final", () => {
  const filas = porEjecutivo(
    [
      empresa({ ejecutivoEmail: "laura@x", enMora: true, ultimoContacto: "2026-11-01T15:00:00Z" }),
      empresa({ ejecutivoEmail: "laura@x" }),
      empresa({}),
    ],
    [
      { responsableEmail: "laura@x", estado: "abierta", venceEl: "2026-11-01", cerradaEl: null }, // vencida
      { responsableEmail: "laura@x", estado: "abierta", venceEl: "2026-11-10", cerradaEl: null },
      { responsableEmail: "laura@x", estado: "hecha", venceEl: "2026-11-03", cerradaEl: "2026-11-02" }, // a tiempo
      { responsableEmail: "laura@x", estado: "hecha", venceEl: "2026-10-20", cerradaEl: "2026-10-25" }, // tarde
      { responsableEmail: "laura@x", estado: "hecha", venceEl: "2026-08-01", cerradaEl: "2026-08-01" }, // hace más de 30 días
      { responsableEmail: "carlos@x", estado: "cancelada", venceEl: HOY, cerradaEl: HOY },
    ],
    new Map([["laura@x", "Laura"]]),
    HOY,
  );
  assert.deepEqual(
    filas.map((f) => [f.nombre, f.clientes, f.enMora, f.contactados, f.tareasAbiertas, f.tareasVencidas, f.hechas30, f.aTiempo30]),
    [
      ["Laura", 2, 1, 1, 2, 1, 2, 1],
      ["carlos@x", 0, 0, 0, 0, 0, 0, 0],
      ["Sin ejecutivo", 1, 0, 0, 0, 0, 0, 0],
    ],
  );
});
