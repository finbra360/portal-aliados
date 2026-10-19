import test from "node:test";
import assert from "node:assert/strict";
import { SignJWT } from "jose";
import { signSession, verifySession } from "./auth.ts";

const original = process.env.JWT_SECRET;
test.before(() => {
  process.env.JWT_SECRET = "secreto-solo-para-pruebas-0123456789";
});
test.after(() => {
  if (original === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = original;
});

const datos = { email: "a@finbra.com", brokerId: "B001", nombre: "Ana" };

test("una sesión firmada se verifica y regresa sus datos", async () => {
  assert.deepEqual(await verifySession(await signSession(datos)), datos);
});

test("un token alterado o de otra clave no es válido", async () => {
  const token = await signSession(datos);
  assert.equal(await verifySession(token.slice(0, -2) + "xx"), null);
  const ajeno = await new SignJWT({ ...datos }).setProtectedHeader({ alg: "HS256" }).sign(new TextEncoder().encode("otra-clave-distinta-0123456789"));
  assert.equal(await verifySession(ajeno), null);
});

test("un token expirado no es válido", async () => {
  const vencido = await new SignJWT({ ...datos })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime(Math.floor(Date.now() / 1000) - 60)
    .sign(new TextEncoder().encode(process.env.JWT_SECRET!));
  assert.equal(await verifySession(vencido), null);
});

test("un token bien firmado pero sin los datos del broker no sirve", async () => {
  const incompleto = await new SignJWT({ email: "a@finbra.com" }).setProtectedHeader({ alg: "HS256" }).sign(new TextEncoder().encode(process.env.JWT_SECRET!));
  assert.equal(await verifySession(incompleto), null);
});

test("basura que no es un token no es válida", async () => {
  assert.equal(await verifySession("no-es-un-token"), null);
  assert.equal(await verifySession(""), null);
});
