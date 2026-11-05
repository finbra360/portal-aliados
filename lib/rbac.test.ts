import test from "node:test";
import assert from "node:assert/strict";
import { ForbiddenError, hasRole, requireRole } from "./rbac.ts";

const sesion = (role: "super_admin" | "comercial" | "finanzas") => ({ email: "a@finbra.com", nombre: "A", role });

test("sin sesión no pasa", () => {
  assert.throws(() => requireRole(null, ["super_admin"]), ForbiddenError);
  assert.equal(hasRole(null, ["super_admin"]), false);
});

test("un rol permitido pasa y regresa la sesión", () => {
  const s = sesion("comercial");
  assert.equal(requireRole(s, ["super_admin", "comercial"]), s);
  assert.equal(hasRole(s, ["comercial"]), true);
});

test("un rol no permitido se rechaza con el mensaje de los roles requeridos", () => {
  assert.throws(() => requireRole(sesion("comercial"), ["finanzas"]), /finanzas/);
  assert.equal(hasRole(sesion("comercial"), ["finanzas"]), false);
});
