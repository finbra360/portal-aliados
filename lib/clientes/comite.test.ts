import { test } from "node:test";
import assert from "node:assert/strict";
import {
  claveDocumento,
  documentosDelNegocio,
  documentosPendientes,
  DOCUMENTOS_DEFAULT,
  leerListaDocumentos,
  listasDesdeAjuste,
  validarAnalisis,
  validarDecision,
  validarDocumentos,
  validarLigaExpediente,
  validarListasDocumentos,
  validarOferta,
} from "./comite.ts";
import { faltantesPara, validarCambioEtapa, type DatosProceso, type ParaRequisitos } from "./negocios.ts";

const SOLICITUD: Omit<ParaRequisitos, "proceso"> = {
  producto: "pyme",
  montoEstimado: 2_000_000,
  plazoMeses: 36,
  destino: "capital_trabajo",
  garantiaTipo: "vehicular",
  rfcEmpresa: "TFI200101AB1",
};
const NADA: DatosProceso = {
  buroResultado: null,
  capacidadPagoMensual: null,
  garantiaValor: null,
  ofertaMonto: null,
  ofertaTasaAnual: null,
  ofertaPlazoMeses: null,
  comisionAperturaPct: null,
  ofertaRespuesta: null,
  expedienteUrl: null,
  documentosPendientes: 3,
  decision: null,
};
const TODO: DatosProceso = {
  buroResultado: "limpio",
  capacidadPagoMensual: 90_000,
  garantiaValor: 3_000_000,
  ofertaMonto: 1_800_000,
  ofertaTasaAnual: 24.5,
  ofertaPlazoMeses: 36,
  comisionAperturaPct: 4,
  ofertaRespuesta: "aceptada",
  expedienteUrl: "https://drive.google.com/drive/folders/abc",
  documentosPendientes: 0,
  decision: "aprobado",
};
const con = (proceso: Partial<DatosProceso>): ParaRequisitos => ({ ...SOLICITUD, proceso: { ...NADA, ...proceso } });

test("análisis: buró del catálogo y capacidad de pago como monto", () => {
  assert.deepEqual(validarAnalisis({ buroResultado: "observaciones", capacidadPagoMensual: "$85,000", notas: " Dos atrasos en 2024 " }), {
    ok: true,
    datos: { buroResultado: "observaciones", capacidadPagoMensual: 85_000, notas: "Dos atrasos en 2024" },
  });
  assert.deepEqual(validarAnalisis({}), { ok: true, datos: { buroResultado: null, capacidadPagoMensual: null, notas: null } });
  assert.equal(validarAnalisis({ buroResultado: "excelente" }).ok, false);
  assert.equal(validarAnalisis({ capacidadPagoMensual: "mucho" }).ok, false);
});

test("oferta: tasa y comisión con hasta dos decimales, plazo entero, respuesta del catálogo", () => {
  assert.deepEqual(validarOferta({ monto: "1,800,000", tasaAnual: "24.5%", plazoMeses: "36", comisionAperturaPct: "4", respuesta: "aceptada" }), {
    ok: true,
    datos: { monto: 1_800_000, tasaAnual: 24.5, plazoMeses: 36, comisionAperturaPct: 4, respuesta: "aceptada" },
  });
  assert.equal(validarOferta({}).ok, true);
  assert.equal(validarOferta({ tasaAnual: "0" }).ok, false);
  assert.equal(validarOferta({ tasaAnual: "24.555" }).ok, false);
  assert.equal(validarOferta({ comisionAperturaPct: "25" }).ok, false);
  assert.equal(validarOferta({ plazoMeses: "12.5" }).ok, false);
  assert.equal(validarOferta({ respuesta: "tal vez" }).ok, false);
});

test("decisión: aprobado pide monto, tasa y plazo; rechazado pide el porqué", () => {
  assert.deepEqual(validarDecision({ decision: "aprobado", monto: "1,500,000", tasaAnual: "26", plazoMeses: "24", condiciones: "Aval del socio mayoritario" }), {
    ok: true,
    datos: { decision: "aprobado", monto: 1_500_000, tasaAnual: 26, plazoMeses: 24, condiciones: "Aval del socio mayoritario" },
  });
  assert.deepEqual(validarDecision({ decision: "aprobado", monto: "1,500,000", plazoMeses: "24" }), { ok: false, error: "Escribe la tasa anual aprobada (de 0.01 a 100 %)." });
  assert.deepEqual(validarDecision({ decision: "rechazado" }), { ok: false, error: "Escribe por qué lo rechazó el comité." });
  assert.deepEqual(validarDecision({ decision: "rechazado", monto: "5", condiciones: "Capacidad de pago insuficiente" }), {
    ok: true,
    datos: { decision: "rechazado", monto: null, tasaAnual: null, plazoMeses: null, condiciones: "Capacidad de pago insuficiente" },
  });
  assert.equal(validarDecision({ decision: "tal vez" }).ok, false);
});

test("documentos: clave sin acentos, una lista por renglón sin viñetas ni repetidos", () => {
  assert.equal(claveDocumento("Constancia de situación fiscal"), "constancia-de-situacion-fiscal");
  assert.deepEqual(leerListaDocumentos("- Acta constitutiva\n\n2. Comprobante de domicilio\r\n", "PyME"), { ok: true, datos: ["Acta constitutiva", "Comprobante de domicilio"] });
  assert.deepEqual(leerListaDocumentos("Acta\nActa", "PyME"), { ok: false, error: "PyME: «Acta» está repetido." });
  assert.deepEqual(leerListaDocumentos("  ", "PyME"), { ok: false, error: "PyME: escribe al menos un documento." });
  const r = validarListasDocumentos({ docs_pyme: "A", docs_simple: "B", docs_arrendamiento: "C\nD" });
  assert.deepEqual(r, { ok: true, datos: { pyme: ["A"], simple: ["B"], arrendamiento: ["C", "D"] } });
  assert.equal(validarListasDocumentos({ docs_pyme: "A", docs_simple: "" }).ok, false);
});

test("documentos: lo guardado mal o ausente usa la lista de siempre", () => {
  assert.deepEqual(listasDesdeAjuste(null), DOCUMENTOS_DEFAULT);
  const l = listasDesdeAjuste({ pyme: ["Solo uno"], simple: [], arrendamiento: [3] });
  assert.deepEqual(l.pyme, ["Solo uno"]);
  assert.deepEqual(l.simple, DOCUMENTOS_DEFAULT.simple);
  assert.deepEqual(l.arrendamiento, DOCUMENTOS_DEFAULT.arrendamiento);
});

test("documentos del negocio: estado por clave; los que ya no están en la lista no cuentan", () => {
  const docs = documentosDelNegocio(["Acta constitutiva", "Comprobante de domicilio", "RFC"], [
    { clave: "acta-constitutiva", estado: "recibido", actualizadoPor: "ana@finbra.test", actualizadoAt: "2026-11-24T18:00:00.000Z" },
    { clave: "rfc", estado: "no_aplica", actualizadoPor: "ana@finbra.test", actualizadoAt: null },
    { clave: "documento-viejo", estado: "pendiente", actualizadoPor: null, actualizadoAt: null },
  ]);
  assert.deepEqual(
    docs.map((d) => [d.clave, d.estado]),
    [
      ["acta-constitutiva", "recibido"],
      ["comprobante-de-domicilio", "pendiente"],
      ["rfc", "no_aplica"],
    ],
  );
  assert.equal(documentosPendientes(docs), 1);
  assert.deepEqual(validarDocumentos(["Acta constitutiva", "RFC"], { "doc_acta-constitutiva": "recibido", doc_rfc: "", doc_otro: "recibido" }), {
    ok: true,
    datos: [{ clave: "acta-constitutiva", nombre: "Acta constitutiva", estado: "recibido" }],
  });
  assert.equal(validarDocumentos(["RFC"], { doc_rfc: "perdido" }).ok, false);
});

test("liga del expediente: https completa", () => {
  assert.deepEqual(validarLigaExpediente(" https://drive.google.com/drive/folders/abc "), { ok: true, datos: "https://drive.google.com/drive/folders/abc" });
  assert.deepEqual(validarLigaExpediente(""), { ok: true, datos: null });
  assert.equal(validarLigaExpediente("drive.google.com/abc").ok, false);
  assert.equal(validarLigaExpediente("http://drive.google.com/abc").ok, false);
});

test("pasos del proceso: cada etapa pide lo suyo al cruzarla", () => {
  assert.deepEqual(faltantesPara("oferta", con({}), "analisis"), ["resultado de buró", "capacidad de pago", "valor de la garantía"]);
  assert.deepEqual(faltantesPara("oferta", { ...con({ buroResultado: "limpio", capacidadPagoMensual: 1 }), garantiaTipo: "sin_garantia" }, "analisis"), []);
  assert.deepEqual(faltantesPara("expediente", con({ ...TODO, ofertaRespuesta: null, comisionAperturaPct: null }), "oferta"), [
    "la oferta completa (monto, tasa, plazo y comisión)",
    "que el cliente acepte la oferta",
  ]);
  assert.deepEqual(faltantesPara("comite", con({ ...TODO, expedienteUrl: null, documentosPendientes: 2 }), "expediente"), [
    "la liga a la carpeta del expediente",
    "2 documentos del expediente",
  ]);
  assert.deepEqual(faltantesPara("formalizacion", con({ ...TODO, decision: "rechazado" }), "comite"), ["la aprobación del comité"]);
  assert.deepEqual(faltantesPara("dispersado", con(TODO), "formalizacion"), []);
});

test("pasos del proceso: lo ya cruzado no se pide otra vez; reabrir y la base sin O5 sí y no", () => {
  // Migrado de Operaciones en Formalización: puede dispersar sin capturar análisis ni comité.
  assert.deepEqual(faltantesPara("dispersado", con({}), "formalizacion"), []);
  // En Comité solo le falta la aprobación para Formalización, aunque no tenga análisis.
  assert.deepEqual(faltantesPara("formalizacion", con({}), "comite"), ["la aprobación del comité"]);
  // Reabrir un pospuesto en Expediente pide los pasos de Oferta y Expediente.
  assert.equal(faltantesPara("expediente", con({}), "pospuesto").length, 5);
  // Sin columnas de O5 (falta correr el SQL) no se piden.
  assert.deepEqual(faltantesPara("dispersado", { ...SOLICITUD, proceso: null }, "analisis"), []);
  const r = validarCambioEtapa("analisis", "oferta", {}, "2026-11-24", con({ buroResultado: "malo" }));
  assert.deepEqual(r, { ok: false, error: "Para pasar a Oferta falta: capacidad de pago y valor de la garantía." });
});

test("el rechazo en comité no se elige a mano", () => {
  assert.deepEqual(validarCambioEtapa("comite", "rechazado", { motivoRechazo: "comite" }, "2026-11-24", con(TODO)), {
    ok: false,
    error: "El rechazo en comité se registra con la decisión del comité.",
  });
});
