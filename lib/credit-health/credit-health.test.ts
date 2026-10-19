import test from "node:test";
import assert from "node:assert/strict";
import { createCipheriv, randomBytes } from "node:crypto";
import { descifrar } from "./cifrado.ts";
import { aCsv, csvCelda } from "./csv.ts";
import { filtrosQuery, parseFiltros } from "./filtros.ts";
import { CH_BORRAN, CH_EDITAN_POLITICAS, CH_EXPORTAN, CH_OPERAN, CH_VEN, CH_VEN_CONTACTO } from "./roles.ts";

/** Cifra igual que finbra360/credit-health (src/lib/security/crypto.ts). */
function cifrar(texto: string, llave: Buffer) {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", llave, iv);
  const datos = Buffer.concat([c.update(texto, "utf8"), c.final()]);
  return `v1:${Buffer.concat([iv, c.getAuthTag(), datos]).toString("base64")}`;
}

test("descifra los contactos de Credit Health con la misma llave", () => {
  const llave = randomBytes(32);
  const cifrado = cifrar("Contacto Ñandú <a@ejemplo.test>", llave);
  assert.equal(descifrar(cifrado, llave.toString("base64")), "Contacto Ñandú <a@ejemplo.test>");
});

test("con otra llave o un dato alterado no descifra", () => {
  const llave = randomBytes(32);
  const cifrado = cifrar("dato", llave);
  assert.throws(() => descifrar(cifrado, randomBytes(32).toString("base64")));
  assert.throws(() => descifrar(cifrado.slice(0, -4) + "AAAA", llave.toString("base64")));
  assert.throws(() => descifrar("v2:xxx", llave.toString("base64")), /Formato/);
  assert.throws(() => descifrar(cifrado, "corta"), /32 bytes/);
});

test("los filtros solo aceptan valores de la lista blanca", () => {
  const f = parseFiltros({ clasificacion: "alta_prioridad'; drop table leads;--", contacto: "nuevo", sector: "31-33", montoMin: "1,000,000", orden: "x" });
  assert.equal(f.clasificacion, undefined);
  assert.equal(f.contacto, "nuevo");
  assert.equal(f.sector, "31-33");
  assert.equal(f.montoMin, 1_000_000);
  assert.equal(f.orden, "recientes");
  assert.equal(f.incluirDemo, false);
  assert.equal(f.pagina, 1);
  assert.equal(parseFiltros({ sector: "99" }).sector, undefined);
  assert.equal(parseFiltros({ demo: "1", pagina: "3" }).incluirDemo, true);
});

test("la URL conserva los filtros y aplica cambios", () => {
  assert.equal(filtrosQuery({ q: "taller", pagina: "2" }, { pagina: "3" }), "?q=taller&pagina=3");
  assert.equal(filtrosQuery({}, {}), "");
});

test("el CSV neutraliza fórmulas y escapa comillas", () => {
  assert.equal(csvCelda('=HYPERLINK("x")'), `"'=HYPERLINK(""x"")"`);
  assert.equal(csvCelda("+52 55"), "'+52 55");
  assert.equal(csvCelda("@SUM(A1)"), "'@SUM(A1)");
  assert.equal(csvCelda(-1500), "-1500");
  assert.equal(csvCelda("Distribuidora, S.A."), '"Distribuidora, S.A."');
  assert.equal(csvCelda(null), "");
  assert.ok(aCsv(["a"], [["á"]]).startsWith("﻿"));
});

test("permisos: comercial opera, finanzas solo consulta, super_admin todo", () => {
  assert.deepEqual(CH_VEN, ["super_admin", "comercial", "finanzas"]);
  for (const lista of [CH_OPERAN, CH_VEN_CONTACTO, CH_EXPORTAN]) {
    assert.ok(lista.includes("comercial"));
    assert.ok(!lista.includes("finanzas"));
  }
  assert.deepEqual(CH_BORRAN, ["super_admin"]);
  assert.deepEqual(CH_EDITAN_POLITICAS, ["super_admin"]);
});
