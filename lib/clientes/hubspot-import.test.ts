import { test } from "node:test";
import assert from "node:assert/strict";
import { etapaDesdeHubspot, leerCsv, leerExport, leerFecha, origenDesdeHubspot, planImportacion } from "./hubspot-import.ts";

// Export ficticio, como lo baja HubSpot en español (con BOM y una nota con coma y salto de renglón).
const EXPORT = [
  "﻿ID de registro,Nombre del negocio,Etapa del negocio,Pipeline,Valor,Fecha de creación,Última actividad,Propietario del negocio,Origen,Empresa asociada",
  '101,"Mudanzas Ficticias, crédito",Oferta Comercial,Pipeline de ventas,"1,200,000",2026-08-01 10:00,2026-11-10 09:00,Ana Demo,Broker,"MUDANZAS FICTICIAS DEL CENTRO, S.A. DE C.V."',
  "102,Panadería Ficticia,Cliente Potencial,Pipeline de ventas,500000,2025-05-01,2025-06-01,Persona Externa,Pymio,Panadería Ficticia",
  "103,Talleres Ejemplo renovación,Solicitud de crédito,Renovaciones/Financieras,800000,2026-10-01,2026-11-20,ana@finbra.test,,Talleres Ejemplo Norte",
  "104,Cerrado Ficticio,Contrato Ganado,Pipeline de ventas,900000,2025-01-01,2025-02-01,Ana Demo,,Cerrado Ficticio",
  "105,Raro Ficticio,Etapa Inventada,Pipeline de ventas,,2026-11-01,2026-11-02,,,Raro Ficticio",
  "",
].join("\r\n");

test("CSV: comillas, comas dentro, punto y coma y renglones vacíos", () => {
  assert.deepEqual(leerCsv('a,b\r\n"x, y","di ""hola"""\r\n\r\n'), [
    ["a", "b"],
    ["x, y", 'di "hola"'],
  ]);
  assert.deepEqual(leerCsv("a;b\n1;2"), [
    ["a", "b"],
    ["1", "2"],
  ]);
  assert.deepEqual(leerCsv('a\n"dos\nrenglones"'), [["a"], ["dos\nrenglones"]]);
});

test("fechas del export", () => {
  assert.equal(leerFecha("2026-08-01 10:00"), "2026-08-01");
  assert.equal(leerFecha("2026-08-01T10:00:00Z"), "2026-08-01");
  assert.equal(leerFecha("5/7/2025"), "2025-07-05");
  assert.equal(leerFecha(""), null);
});

test("export: columnas en español, monto con comas y la empresa asociada", () => {
  const r = leerExport(EXPORT);
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.equal(r.filas.length, 5);
  assert.deepEqual(r.filas[0], {
    hubspotId: "101",
    nombre: "Mudanzas Ficticias, crédito",
    empresa: "MUDANZAS FICTICIAS DEL CENTRO, S.A. DE C.V.",
    etapaHubspot: "Oferta Comercial",
    pipeline: "Pipeline de ventas",
    monto: 1_200_000,
    creadoEl: "2026-08-01",
    ultimaActividad: "2026-11-10",
    propietario: "Ana Demo",
    origenHubspot: "Broker",
  });
  assert.equal(r.sinEmpresa, false);
});

test("export: sin las columnas mínimas da un error claro; sin empresa usa el nombre del negocio", () => {
  assert.deepEqual(leerExport("Nombre,Etapa\nx,y"), {
    ok: false,
    error: "Al archivo le faltan columnas: «ID de registro», «Nombre del negocio», «Pipeline». Expórtalo desde Negocios con todas las propiedades.",
  });
  const r = leerExport("Record ID,Deal Name,Deal Stage,Pipeline\n7,Fictional Deal,Oportunidad,Pipeline de ventas");
  assert.ok(r.ok && r.sinEmpresa && r.filas[0].empresa === "Fictional Deal");
});

test("etapas y orígenes de HubSpot", () => {
  assert.equal(etapaDesdeHubspot("Cliente Potencial"), "prospecto");
  assert.equal(etapaDesdeHubspot("Cotización"), "calificado");
  assert.equal(etapaDesdeHubspot("Visita domiciliaria"), "analisis");
  assert.equal(etapaDesdeHubspot("Instalación GPS/Mediación"), "formalizacion");
  assert.equal(etapaDesdeHubspot("closedlost"), "cerrado");
  assert.equal(etapaDesdeHubspot("Rechazados"), "cerrado");
  assert.equal(etapaDesdeHubspot("Otra"), null);
  assert.deepEqual(origenDesdeHubspot("Página web", "Pipeline de ventas"), { origen: "web", tipo: "nuevo" });
  assert.deepEqual(origenDesdeHubspot(null, "Pipeline de ventas"), { origen: "manual", tipo: "nuevo" });
  assert.deepEqual(origenDesdeHubspot("Broker", "Renovaciones/Financieras"), { origen: "renovacion", tipo: "renovacion" });
});

test("vista previa: sin cerrados; empresa por nombre; responsable por nombre o correo; marcados los activos", () => {
  const r = leerExport(EXPORT);
  assert.ok(r.ok);
  if (!r.ok) return;
  const plan = planImportacion(r.filas, {
    hoy: "2026-11-24",
    importados: new Set(["103"]),
    empresas: [
      { id: "e1", nombre: "Mudanzas Ficticias del Centro", razonSocial: null },
      { id: "e2", nombre: "TALLERES EJEMPLO NORTE", razonSocial: "TALLERES EJEMPLO NORTE SA DE CV" },
      { id: "e3", nombre: "Mudanzas", razonSocial: null },
    ],
    usuarios: [{ email: "ana@finbra.test", nombre: "Ana Demo" }],
  });
  const por = Object.fromEntries(plan.map((p) => [p.fila.hubspotId, p]));
  assert.equal(por["104"], undefined); // Contrato Ganado: no se trae.
  assert.equal(plan.length, 4);
  // Activo y sin importar: se marca solo, con su empresa (no la que solo se llama «Mudanzas») y su responsable.
  assert.equal(por["101"].marcado, true);
  assert.deepEqual(por["101"].empresa, { id: "e1", nombre: "Mudanzas Ficticias del Centro" });
  assert.deepEqual(por["101"].responsable, { email: "ana@finbra.test", nombre: "Ana Demo" });
  assert.equal(por["101"].etapa, "oferta");
  assert.equal(por["101"].origen, "broker");
  // Sin actividad en 6 meses: no se marca; empresa nueva y dueño que no está en el backoffice.
  assert.equal(por["102"].marcado, false);
  assert.equal(por["102"].empresa, null);
  assert.equal(por["102"].responsable, null);
  // Ya importado: no se marca. Renovación de un cliente que ya existe.
  assert.equal(por["103"].yaImportado, true);
  assert.equal(por["103"].marcado, false);
  assert.equal(por["103"].tipo, "renovacion");
  assert.deepEqual(por["103"].responsable, { email: "ana@finbra.test", nombre: "Ana Demo" });
  // Etapa desconocida: con problema y sin marcar.
  assert.equal(por["105"].problema, "No conocemos la etapa «Etapa Inventada».");
  assert.equal(por["105"].marcado, false);
  // Los marcados van primero.
  assert.equal(plan[0].fila.hubspotId, "101");
});
