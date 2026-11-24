import { test } from "node:test";
import assert from "node:assert/strict";
import { diasEnEtapa, faltantesPara, leerMonto, leerTelefono, totalesPorEtapa, validarCambioEtapa, validarNegocio, validarSolicitud, type ParaRequisitos } from "./negocios.ts";

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

const HOY = "2026-11-24";
const COMPLETO: ParaRequisitos = { producto: "pyme", montoEstimado: 2_000_000, plazoMeses: 36, destino: "capital_trabajo", garantiaTipo: "vehicular", rfcEmpresa: "TFI200101AB1" };
const VACIO: ParaRequisitos = { producto: null, montoEstimado: null, plazoMeses: null, destino: null, garantiaTipo: null, rfcEmpresa: null };
const mover = (actual: Parameters<typeof validarCambioEtapa>[0], nueva: string, entrada = {}, datos = COMPLETO) => validarCambioEtapa(actual, nueva, entrada, HOY, datos);

test("cambio de etapa: avanzar con los datos completos; regresar pide motivo; dispersado no cambia", () => {
  assert.deepEqual(mover("prospecto", "solicitud"), { ok: true, datos: { etapa: "solicitud", motivo: null, recontactarEl: null, rechazoMotivo: null, rechazoPor: null } });
  assert.deepEqual(mover("comite", "expediente"), { ok: false, error: "Escribe por qué regresa a una etapa anterior." });
  assert.equal(mover("comite", "expediente", { motivo: "Falta un documento" }).ok, true);
  assert.equal(mover("dispersado", "comite", { motivo: "error" }).ok, false);
  assert.equal(mover("solicitud", "solicitud").ok, false);
  assert.equal(mover("solicitud", "ganado").ok, false);
});

test("requisitos por etapa: calificado pide producto, monto y garantía; solicitud además RFC, plazo y destino", () => {
  assert.deepEqual(faltantesPara("prospecto", VACIO), []);
  assert.deepEqual(faltantesPara("calificado", VACIO), ["producto", "monto estimado", "tipo de garantía"]);
  assert.deepEqual(faltantesPara("comite", { ...COMPLETO, rfcEmpresa: null, plazoMeses: null }), ["RFC de la empresa", "plazo"]);
  assert.deepEqual(faltantesPara("rechazado", VACIO), []);
  assert.deepEqual(mover("prospecto", "calificado", {}, { ...VACIO, producto: "pyme" }), {
    ok: false,
    error: "Para pasar a Calificado falta: monto estimado y tipo de garantía.",
  });
  // Regresar no pide datos; reabrir un pospuesto sí.
  assert.equal(mover("solicitud", "prospecto", { motivo: "Se enfrió" }, VACIO).ok, true);
  assert.equal(mover("pospuesto", "solicitud", {}, VACIO).ok, false);
});

test("posponer pide motivo y una fecha futura de hasta dos años", () => {
  assert.deepEqual(mover("oferta", "pospuesto", { recontactarEl: "2027-01-15" }), { ok: false, error: "Escribe por qué se pospone." });
  assert.deepEqual(mover("oferta", "pospuesto", { motivo: "Temporada alta" }), { ok: false, error: "Elige cuándo volver a contactarlo." });
  assert.equal(mover("oferta", "pospuesto", { motivo: "x", recontactarEl: HOY }).ok, false);
  assert.equal(mover("oferta", "pospuesto", { motivo: "x", recontactarEl: "2029-01-01" }).ok, false);
  const r = mover("oferta", "pospuesto", { motivo: "Temporada alta", recontactarEl: "2027-01-15" }, VACIO);
  assert.deepEqual(r, { ok: true, datos: { etapa: "pospuesto", motivo: "Temporada alta", recontactarEl: "2027-01-15", rechazoMotivo: null, rechazoPor: null } });
});

test("rechazar pide un motivo del catálogo y guarda quién cerró", () => {
  assert.deepEqual(mover("oferta", "rechazado", { motivo: "No le alcanzó" }), { ok: false, error: "Elige el motivo del rechazo." });
  assert.deepEqual(mover("oferta", "rechazado", { motivoRechazo: "costo" }, VACIO), {
    ok: true,
    datos: { etapa: "rechazado", motivo: "Tasa o costo", recontactarEl: null, rechazoMotivo: "costo", rechazoPor: "cliente" },
  });
  const r = mover("analisis", "rechazado", { motivoRechazo: "capacidad", motivo: "DSCR de 0.9" });
  assert.equal(r.ok && r.datos.motivo, "Capacidad de pago insuficiente: DSCR de 0.9");
  assert.equal(r.ok && r.datos.rechazoPor, "finbra");
});

test("solicitud: valida catálogos, plazo y montos; sin garantía borra su detalle", () => {
  const r = validarSolicitud({ producto: "pyme", montoEstimado: "2,000,000", plazoMeses: "36", destino: "capital_trabajo", garantiaTipo: "vehicular", garantiaValor: "3,500,000" });
  assert.deepEqual(r, {
    ok: true,
    datos: { producto: "pyme", montoEstimado: 2_000_000, plazoMeses: 36, destino: "capital_trabajo", destinoDetalle: null, garantiaTipo: "vehicular", garantiaDetalle: null, garantiaValor: 3_500_000 },
  });
  assert.equal(validarSolicitud({}).ok, true);
  assert.deepEqual(validarSolicitud({ plazoMeses: "0" }), { ok: false, error: "El plazo va de 1 a 120 meses." });
  assert.deepEqual(validarSolicitud({ plazoMeses: "12.5" }), { ok: false, error: "El plazo va de 1 a 120 meses." });
  assert.equal(validarSolicitud({ producto: "hipoteca" }).ok, false);
  const s = validarSolicitud({ garantiaTipo: "sin_garantia", garantiaDetalle: "algo", garantiaValor: "100" });
  assert.equal(s.ok && s.datos.garantiaDetalle, null);
  assert.equal(s.ok && s.datos.garantiaValor, null);
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
