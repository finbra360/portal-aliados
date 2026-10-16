import test from "node:test";
import assert from "node:assert/strict";
import { anuncioVigente, audienciaIncluye, ctaUrlSegura, estadoDeAnuncio, leerAudiencia, validarAnuncio } from "./anuncios.ts";

const HOY = "2026-10-16";
const base = { titulo: "Nuevo concurso", mensaje: "Ya está abierto el concurso de octubre." };

test("audiencia: todos incluye a cualquiera; brokers solo a los de la lista", () => {
  assert.equal(audienciaIncluye({ tipo: "todos" }, "B001"), true);
  assert.equal(audienciaIncluye({ tipo: "brokers", ids: ["B002"] }, "B001"), false);
  assert.equal(audienciaIncluye({ tipo: "brokers", ids: ["B001", "B002"] }, "B001"), true);
});

test("audiencia guardada: se lee tolerante y descarta ids que no son texto", () => {
  assert.deepEqual(leerAudiencia({ tipo: "brokers", ids: ["B001", 7, null] }), { tipo: "brokers", ids: ["B001"] });
  assert.deepEqual(leerAudiencia({ tipo: "todos" }), { tipo: "todos" });
  assert.deepEqual(leerAudiencia(null), { tipo: "todos" });
});

test("vigencia: programado, vigente y terminado", () => {
  const a = { fechaPublicacion: "2026-10-10T00:00:00Z", fechaExpiracion: "2026-10-20T00:00:00Z" };
  assert.equal(estadoDeAnuncio(a, "2026-10-09T00:00:00Z"), "programado");
  assert.equal(estadoDeAnuncio(a, "2026-10-15T00:00:00Z"), "vigente");
  assert.equal(estadoDeAnuncio(a, "2026-10-20T00:00:00Z"), "terminado");
  assert.equal(anuncioVigente({ ...a, fechaExpiracion: null }, "2030-01-01T00:00:00Z"), true);
  assert.equal(anuncioVigente(a, "2026-10-21T00:00:00Z"), false);
});

test("enlace del botón: https o ruta del portal, nunca javascript: ni //", () => {
  assert.equal(ctaUrlSegura("https://finbra.com/promo"), true);
  assert.equal(ctaUrlSegura("/ranking"), true);
  assert.equal(ctaUrlSegura("javascript:alert(1)"), false);
  assert.equal(ctaUrlSegura("http://finbra.com"), false);
  assert.equal(ctaUrlSegura("//malo.com"), false);
  assert.equal(ctaUrlSegura("finbra.com"), false);
});

test("validar: anuncio mínimo para todos", () => {
  const r = validarAnuncio(base, HOY);
  assert.ok(r.ok);
  if (r.ok) {
    assert.deepEqual(r.audiencia, { tipo: "todos" });
    assert.equal(r.ctaTexto, null);
    assert.equal(r.expiraEl, null);
  }
});

test("validar: falta título o mensaje, o se pasan del límite", () => {
  assert.equal(validarAnuncio({ ...base, titulo: "  " }, HOY).ok, false);
  assert.equal(validarAnuncio({ ...base, mensaje: "" }, HOY).ok, false);
  assert.equal(validarAnuncio({ ...base, titulo: "x".repeat(121) }, HOY).ok, false);
  assert.equal(validarAnuncio({ ...base, mensaje: "x".repeat(601) }, HOY).ok, false);
});

test("validar: el botón lleva texto y enlace juntos, y el enlace debe ser seguro", () => {
  assert.equal(validarAnuncio({ ...base, ctaTexto: "Ver" }, HOY).ok, false);
  assert.equal(validarAnuncio({ ...base, ctaUrl: "/ranking" }, HOY).ok, false);
  assert.equal(validarAnuncio({ ...base, ctaTexto: "Ver", ctaUrl: "javascript:x" }, HOY).ok, false);
  const r = validarAnuncio({ ...base, ctaTexto: "Ver ranking", ctaUrl: "/ranking" }, HOY);
  assert.ok(r.ok && r.ctaUrl === "/ranking");
});

test("validar: brokers específicos se normalizan, sin repetidos; vacío o inválido se rechaza", () => {
  const r = validarAnuncio({ ...base, audiencia: "brokers", brokers: "b1, B001\nfapbr044;B002" }, HOY);
  assert.ok(r.ok);
  if (r.ok) assert.deepEqual(r.audiencia, { tipo: "brokers", ids: ["B001", "FAPBR044", "B002"] });
  assert.equal(validarAnuncio({ ...base, audiencia: "brokers", brokers: "  " }, HOY).ok, false);
  assert.equal(validarAnuncio({ ...base, audiencia: "brokers", brokers: "B001 ???" }, HOY).ok, false);
});

test("validar: fecha de expiración válida y no pasada", () => {
  assert.ok(validarAnuncio({ ...base, expiraEl: "2026-10-16" }, HOY).ok);
  assert.equal(validarAnuncio({ ...base, expiraEl: "2026-10-15" }, HOY).ok, false);
  assert.equal(validarAnuncio({ ...base, expiraEl: "2026-02-31" }, HOY).ok, false);
  assert.equal(validarAnuncio({ ...base, expiraEl: "mañana" }, HOY).ok, false);
});
