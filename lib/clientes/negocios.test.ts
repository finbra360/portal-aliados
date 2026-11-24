import { test } from "node:test";
import assert from "node:assert/strict";
import { diasEnEtapa, leerMonto, leerTelefono, totalesPorEtapa, validarCambioEtapa, validarNegocio } from "./negocios.ts";

const EMPRESA = "0f8fad5b-d9cb-469f-a165-70867728950e";

test("monto: acepta comas, signo de pesos y decimales; vacío es null", () => {
  assert.equal(leerMonto("$1,500,000"), 1_500_000);
  assert.equal(leerMonto("2500000.505"), 2_500_000.51);
  assert.equal(leerMonto(""), null);
  assert.equal(leerMonto("dos millones"), "invalido");
  assert.equal(leerMonto("-5"), "invalido");
});

test("teléfono: 10 dígitos, quita el 52 de México", () => {
  assert.equal(leerTelefono("55 1234-5678"), "5512345678");
  assert.equal(leerTelefono("+52 55 1234 5678"), "5512345678");
  assert.equal(leerTelefono("12345"), "invalido");
  assert.equal(leerTelefono(""), null);
});

test("negocio de una empresa existente", () => {
  const r = validarNegocio({ empresaId: EMPRESA, tipo: "renovacion", origen: "renovacion", montoEstimado: "3,000,000", responsableEmail: "Ana@Finbra.test" });
  assert.deepEqual(r, {
    ok: true,
    datos: { empresa: { id: EMPRESA }, contacto: null, tipo: "renovacion", origen: "renovacion", montoEstimado: 3_000_000, responsableEmail: "ana@finbra.test", notas: null },
  });
});

test("negocio con empresa nueva y su contacto", () => {
  const r = validarNegocio({
    empresaNombre: " Transportes Ficticios ",
    empresaRfc: "tfi-200101-ab1",
    origen: "broker",
    contactoNombre: "Persona Ficticia",
    contactoTelefono: "5500000000",
    contactoCorreo: "Contacto@Ejemplo.test",
  });
  assert.ok(r.ok);
  assert.deepEqual(r.ok && r.datos.empresa, { nueva: { nombre: "Transportes Ficticios", razonSocial: null, rfc: "TFI200101AB1" } });
  assert.deepEqual(r.ok && r.datos.contacto, { nombre: "Persona Ficticia", puesto: null, telefono: "5500000000", correo: "contacto@ejemplo.test" });
});

test("rechaza lo que falta o no sirve, con un mensaje claro", () => {
  assert.deepEqual(validarNegocio({ origen: "web" }), { ok: false, error: "Elige una empresa de Clientes o escribe el nombre de la nueva." });
  assert.deepEqual(validarNegocio({ empresaId: EMPRESA }), { ok: false, error: "Elige de dónde llegó el negocio." });
  assert.equal(validarNegocio({ empresaId: EMPRESA, origen: "web", montoEstimado: "500,000,000" }).ok, false);
  assert.equal(validarNegocio({ empresaNombre: "X", empresaRfc: "NOESRFC", origen: "web" }).ok, false);
  assert.deepEqual(validarNegocio({ empresaNombre: "X", origen: "web", contactoTelefono: "5500000000" }), { ok: false, error: "Escribe el nombre de la persona de contacto." });
  assert.deepEqual(validarNegocio({ empresaNombre: "X", origen: "web", tipo: "renovacion" }), { ok: false, error: "Una empresa nueva solo puede tener un crédito nuevo." });
});

test("cambio de etapa: avanzar libre; posponer, rechazar y regresar piden motivo; dispersado no cambia", () => {
  assert.deepEqual(validarCambioEtapa("prospecto", "solicitud", ""), { ok: true, datos: { etapa: "solicitud", motivo: null } });
  assert.equal(validarCambioEtapa("prospecto", "pospuesto", " ").ok, false);
  assert.deepEqual(validarCambioEtapa("oferta", "rechazado", "No le alcanzó el flujo"), { ok: true, datos: { etapa: "rechazado", motivo: "No le alcanzó el flujo" } });
  assert.deepEqual(validarCambioEtapa("comite", "expediente", ""), { ok: false, error: "Escribe por qué regresa a una etapa anterior." });
  assert.equal(validarCambioEtapa("pospuesto", "calificado", "").ok, true);
  assert.equal(validarCambioEtapa("dispersado", "comite", "error").ok, false);
  assert.equal(validarCambioEtapa("solicitud", "solicitud", "").ok, false);
  assert.equal(validarCambioEtapa("solicitud", "ganado", "").ok, false);
});

test("días en etapa y totales por etapa", () => {
  assert.equal(diasEnEtapa("2026-11-20T23:00:00.000Z", "2026-11-24"), 4);
  assert.equal(diasEnEtapa("2026-11-24T08:00:00.000Z", "2026-11-24"), 0);
  const t = totalesPorEtapa([
    { etapa: "prospecto", montoEstimado: 1_000_000 },
    { etapa: "prospecto", montoEstimado: null },
    { etapa: "comite", montoEstimado: 2_500_000 },
  ]);
  assert.deepEqual(t.prospecto, { n: 2, monto: 1_000_000 });
  assert.deepEqual(t.comite, { n: 1, monto: 2_500_000 });
  assert.deepEqual(t.dispersado, { n: 0, monto: 0 });
});
