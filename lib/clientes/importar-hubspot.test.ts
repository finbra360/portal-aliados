import { test } from "node:test";
import assert from "node:assert/strict";
import { leerNegocios, normalizarNombreEmpresa, planearImportacion, type EmpresaExistente, type FilaNegocio } from "./importar-hubspot.ts";

// Todos los nombres e IDs son ficticios.
const ENC = "Incluir,ID negocio HubSpot,Negocio,Fecha de cierre,Monto,Etapa,Pipeline,Producto,Empresa,ID empresa HubSpot,Industria,Sitio web,Número de cliente SIAC";

test("normaliza nombres de empresa: sin acentos, puntuación ni forma legal", () => {
  assert.equal(normalizarNombreEmpresa("QUIMICOS EJEMPLO S. DE R.L. DE C.V."), "quimicos ejemplo");
  assert.equal(normalizarNombreEmpresa("Químicos Ejemplo"), "quimicos ejemplo");
  assert.equal(normalizarNombreEmpresa("Financiera Muestra, S.A.P.I. de C.V., SOFOM, E.N.R."), "financiera muestra");
  assert.equal(normalizarNombreEmpresa("INSTITUTO DE PRUEBAS SA DE CV"), normalizarNombreEmpresa("Instituto de Pruebas"));
  assert.equal(normalizarNombreEmpresa("Logística Demo México"), "logistica demo mexico");
});

test("lee el CSV: montos con signo y comas, pipeline, filas excluidas y errores por fila", () => {
  const csv = [
    ENC,
    'Sí,111,PM - Químicos Ejemplo (2),2025-01-27,"$1,000,000",Contrato Ganado,Nuevo,Crédito PYME,Químicos Ejemplo,90000000001,Productos químicos,quimicos.example,',
    "Sí,222,PM - Químicos Ejemplo,2026-04-13,1800000,Contrato Ganado,Renovaciones/Financieras,Crédito PYME,QUIMICOS EJEMPLO,,,,",
    "No,333,PM - Arrendadora Demo,2024-09-30,50000000,Contrato ganado Leasing,Nuevo,,Arrendadora Demo,,,,",
    "Sí,abc,PM - Malo,2025-01-01,10,,,,Malo,,,,",
    "Sí,444,PM - Fecha mala,27/01/2025,10,,,,Fecha mala,,,,",
    "Sí,111,PM - Repetido,2025-01-01,10,,,,Repetido,,,,",
  ].join("\n");
  const r = leerNegocios(csv);
  assert.ok("filas" in r);
  assert.deepEqual(r.filas.map((f) => [f.dealId, f.monto, f.pipeline]), [["111", 1_000_000, "nuevo"], ["222", 1_800_000, "renovacion"]]);
  assert.deepEqual(r.errores.map((e) => e.fila), [5, 6, 7], "la fila con Incluir = No se omite sin error");
  assert.ok("error" in leerNegocios("Negocio,Monto\nX,1"), "faltan columnas obligatorias");
});

const fila = (over: Partial<FilaNegocio>): FilaNegocio => ({
  fila: 2,
  incluir: true,
  dealId: "1",
  negocio: "PM - X",
  fechaCierre: "2025-01-01",
  monto: 100,
  etapa: "Contrato Ganado",
  pipeline: "nuevo",
  producto: null,
  empresa: "X",
  hubspotEmpresaId: null,
  industria: null,
  sitioWeb: null,
  numeroClienteSiac: null,
  ...over,
});

const EXISTENTES: EmpresaExistente[] = [
  { empresaId: "e-qui", nombre: "QUIMICOS EJEMPLO S DE RL DE CV", razonSocial: "QUIMICOS EJEMPLO S DE RL DE CV", hubspotCompanyId: null, numerosCliente: ["000000101"] },
  { empresaId: "e-fin", nombre: "FINANCIERA MUESTRA SAPI DE CV SOFOM ENR", razonSocial: null, hubspotCompanyId: null, numerosCliente: ["000000102"] },
  { empresaId: "e-tex", nombre: "Textil Demo", razonSocial: null, hubspotCompanyId: "90000000003", numerosCliente: [] },
  { empresaId: "e-g1", nombre: "GRUPO DOBLE SA DE CV", razonSocial: null, hubspotCompanyId: null, numerosCliente: ["000000103"] },
  { empresaId: "e-g2", nombre: "Grupo Doble", razonSocial: null, hubspotCompanyId: null, numerosCliente: ["000000104"] },
];

test("agrupa por la columna Empresa y liga por número de cliente, ID de HubSpot o nombre", () => {
  const plan = planearImportacion(
    [
      fila({ dealId: "1", empresa: "Químicos Ejemplo", monto: 1_000_000, fechaCierre: "2025-01-27" }),
      fila({ dealId: "2", empresa: "QUIMICOS EJEMPLO ", monto: 1_800_000, fechaCierre: "2026-04-13" }),
      fila({ dealId: "3", empresa: "Muestra.mx", numeroClienteSiac: "102" }),
      fila({ dealId: "4", empresa: "Textil Demo, S.A. de C.V.", hubspotEmpresaId: "90000000003" }),
      fila({ dealId: "5", empresa: "Café Ficticio" }),
      fila({ dealId: "6", empresa: "Grupo Doble" }),
      fila({ dealId: "7", empresa: "Otra", numeroClienteSiac: "999" }),
    ],
    EXISTENTES,
  );
  const por = Object.fromEntries(plan.map((p) => [p.clave, p]));
  assert.deepEqual(por["quimicos ejemplo"].destino, { tipo: "existente", empresaId: "e-qui", nombre: "QUIMICOS EJEMPLO S DE RL DE CV", motivo: "nombre" });
  assert.equal(por["quimicos ejemplo"].negocios.length, 2);
  assert.equal(por["quimicos ejemplo"].monto, 2_800_000);
  assert.deepEqual([por["quimicos ejemplo"].primerCierre, por["quimicos ejemplo"].ultimoCierre], ["2025-01-27", "2026-04-13"]);
  assert.deepEqual(por["muestramx"].destino, { tipo: "existente", empresaId: "e-fin", nombre: "FINANCIERA MUESTRA SAPI DE CV SOFOM ENR", motivo: "numero_cliente" }, "el número escrito a mano manda sobre el nombre");
  assert.equal(por["textil demo"].destino.tipo === "existente" && por["textil demo"].destino.motivo, "hubspot");
  assert.deepEqual(por["cafe ficticio"].destino, { tipo: "nueva" });
  assert.equal(por["grupo doble"].destino.tipo, "error", "dos empresas con el mismo nombre: no se adivina");
  assert.equal(por["otra"].destino.tipo, "error", "número de cliente que no existe");
});

test("números de cliente distintos en la misma empresa es un error", () => {
  const [p] = planearImportacion([fila({ dealId: "1", numeroClienteSiac: "101" }), fila({ dealId: "2", numeroClienteSiac: "102" })], EXISTENTES);
  assert.equal(p.destino.tipo, "error");
});
