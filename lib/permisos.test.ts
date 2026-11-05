import test from "node:test";
import assert from "node:assert/strict";
import { ForbiddenError } from "./rbac.ts";
import { PERMISOS, puede, requierePermiso, rolPuede, type Permiso } from "./permisos.ts";

const sesion = (role: "super_admin" | "comercial" | "finanzas") => ({ email: "a@finbra.com", nombre: "A", role });

test("matriz de permisos de cartera y cobranza", () => {
  const matriz = Object.fromEntries(
    (["super_admin", "finanzas", "comercial"] as const).map((r) => [r, (Object.keys(PERMISOS) as Permiso[]).filter((p) => rolPuede(r, p))]),
  );
  assert.deepEqual(matriz, {
    super_admin: ["cartera.ver", "cobranza.operar", "cobranza.configurar"],
    finanzas: ["cartera.ver", "cobranza.operar"],
    comercial: ["cartera.ver"],
  });
});

test("comercial ve la cartera pero no opera cobranza", () => {
  assert.equal(puede(sesion("comercial"), "cartera.ver"), true);
  assert.equal(puede(sesion("comercial"), "cobranza.operar"), false);
  assert.throws(() => requierePermiso(sesion("comercial"), "cobranza.operar"), ForbiddenError);
});

test("sin sesión no hay ningún permiso", () => {
  for (const p of Object.keys(PERMISOS) as Permiso[]) assert.equal(puede(null, p), false);
  assert.throws(() => requierePermiso(null, "cartera.ver"), /Sesión de administrador requerida/);
  assert.equal(rolPuede(null, "cartera.ver"), false);
});

test("requierePermiso regresa la sesión cuando pasa", () => {
  const s = sesion("finanzas");
  assert.equal(requierePermiso(s, "cobranza.operar"), s);
  assert.throws(() => requierePermiso(s, "cobranza.configurar"), ForbiddenError);
});
