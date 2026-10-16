import { test } from "node:test";
import assert from "node:assert/strict";
import { LIMITES, puedePedirCodigo, puedeVerificarCodigo, type ConteoIntentos } from "./login-limites.ts";

const cero: ConteoIntentos = { codigoCorreo: 0, codigoIp: 0, fallosCorreo: 0, fallosIp: 0 };

test("pedir código: pasa mientras no se llegue al tope por correo ni por conexión", () => {
  assert.equal(puedePedirCodigo(cero), true);
  assert.equal(puedePedirCodigo({ ...cero, codigoCorreo: LIMITES.codigoPorCorreo.max - 1 }), true);
  assert.equal(puedePedirCodigo({ ...cero, codigoCorreo: LIMITES.codigoPorCorreo.max }), false);
  assert.equal(puedePedirCodigo({ ...cero, codigoIp: LIMITES.codigoPorIp.max }), false);
});

test("verificar código: al llegar al tope de fallos se bloquea, por correo o por conexión", () => {
  assert.equal(puedeVerificarCodigo({ ...cero, fallosCorreo: LIMITES.fallosPorCorreo.max - 1 }), true);
  assert.equal(puedeVerificarCodigo({ ...cero, fallosCorreo: LIMITES.fallosPorCorreo.max }), false);
  assert.equal(puedeVerificarCodigo({ ...cero, fallosIp: LIMITES.fallosPorIp.max }), false);
});

test("pedir códigos no cuenta como fallos al verificar, y al revés", () => {
  assert.equal(puedeVerificarCodigo({ ...cero, codigoCorreo: 99, codigoIp: 99 }), true);
  assert.equal(puedePedirCodigo({ ...cero, fallosCorreo: 99, fallosIp: 99 }), true);
});

test("ninguna ventana pasa de una hora (la consulta solo mira la última hora)", () => {
  for (const l of Object.values(LIMITES)) assert.ok(l.minutos <= 60);
});
