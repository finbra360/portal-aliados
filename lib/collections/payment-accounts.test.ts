import { test } from "node:test";
import assert from "node:assert/strict";
import { formatClabe, instruccionesDePago, validarClabe, validarCuenta } from "./payment-accounts.ts";

// CLABE de ejemplo con dígito verificador correcto (no es una cuenta de Finbra).
const CLABE = "032180000118359719";

test("CLABE: 18 dígitos con dígito verificador", () => {
  assert.deepEqual(validarClabe(CLABE), { ok: true, clabe: CLABE });
  assert.deepEqual(validarClabe("032 180 00011835971 9"), { ok: true, clabe: CLABE }, "acepta espacios");
  assert.deepEqual(validarClabe("032-180-000118359719"), { ok: true, clabe: CLABE }, "acepta guiones");
  assert.match((validarClabe("032180000118359718") as { error: string }).error, /verificador/);
  assert.match((validarClabe("03218000011835971") as { error: string }).error, /18 dígitos/);
  assert.match((validarClabe("03218000011835971A") as { error: string }).error, /18 dígitos/);
});

test("cuenta: alias, banco y beneficiario obligatorios; la CLABE solo al darla de alta", () => {
  assert.deepEqual(validarCuenta({ alias: " BBVA cobranza ", banco: "BBVA", beneficiario: "Finbra SOFOM", clabe: CLABE }), {
    ok: true,
    alias: "BBVA cobranza",
    banco: "BBVA",
    beneficiario: "Finbra SOFOM",
    clabe: CLABE,
  });
  assert.equal(validarCuenta({ alias: "", banco: "BBVA", beneficiario: "Finbra", clabe: CLABE }).ok, false);
  assert.equal(validarCuenta({ alias: "x", banco: "BBVA", beneficiario: "  ", clabe: CLABE }).ok, false);
  assert.equal(validarCuenta({ alias: "x", banco: "BBVA", beneficiario: "Finbra", clabe: "123" }).ok, false);
  assert.deepEqual(validarCuenta({ alias: "x", banco: "BBVA", beneficiario: "Finbra" }), { ok: true, alias: "x", banco: "BBVA", beneficiario: "Finbra", clabe: null }, "al editar no se toca la CLABE");
});

test("instrucciones de pago: cuenta y número de crédito como concepto", () => {
  const cuenta = { banco: "BBVA", beneficiario: "Finbra SOFOM", clabe: CLABE };
  assert.equal(
    instruccionesDePago(cuenta, ["2001"]),
    `Transfiere a BBVA, a nombre de Finbra SOFOM, CLABE ${CLABE}. En el concepto escribe tu número de crédito: 2001.`,
  );
  assert.match(instruccionesDePago(cuenta, ["2001", "2002 R", "2003"]), /crédito que pagas: 2001, 2002 R o 2003\.$/);
  assert.equal(formatClabe(CLABE), "032 180 00011835971 9");
});
