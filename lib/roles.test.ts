import { test } from "node:test";
import assert from "node:assert/strict";
import { errorCambioRol, errorDesactivar, etiquetaRol } from "./roles.ts";

const usuarios = [
  { email: "yo@finbra.com", role: "super_admin", activo: true },
  { email: "otra@finbra.com", role: "super_admin", activo: true },
  { email: "ventas@finbra.com", role: "comercial", activo: true },
  { email: "baja@finbra.com", role: "super_admin", activo: false },
];

test("cambiar rol: válido, a uno mismo no se le quita Super Admin, queda al menos uno", () => {
  const base = { actor: "yo@finbra.com", usuarios };
  assert.equal(errorCambioRol({ ...base, email: "ventas@finbra.com", nuevo: "finanzas" }), null);
  assert.equal(errorCambioRol({ ...base, email: "ventas@finbra.com", nuevo: "super_admin" }), null);
  assert.equal(errorCambioRol({ ...base, email: "otra@finbra.com", nuevo: "comercial" }), null);
  assert.match(errorCambioRol({ ...base, email: "yo@finbra.com", nuevo: "comercial" })!, /a ti mismo/);
  assert.equal(errorCambioRol({ ...base, email: "yo@finbra.com", nuevo: "super_admin" }), null);
  assert.equal(errorCambioRol({ ...base, email: "ventas@finbra.com", nuevo: "jefe" }), "Ese rol no existe.");
  assert.equal(errorCambioRol({ ...base, email: "nadie@finbra.com", nuevo: "comercial" }), "Ese usuario no existe.");
  // Si solo queda otra Super Admin activa, no se le puede quitar (el inactivo no cuenta).
  const solo = [usuarios[1], usuarios[2], usuarios[3]];
  assert.match(errorCambioRol({ actor: "ventas@finbra.com", email: "otra@finbra.com", nuevo: "finanzas", usuarios: solo })!, /al menos un Super Admin/);
});

test("desactivar: no a uno mismo ni al último Super Admin activo", () => {
  assert.equal(errorDesactivar({ actor: "yo@finbra.com", email: "otra@finbra.com", usuarios }), null);
  assert.match(errorDesactivar({ actor: "yo@finbra.com", email: "yo@finbra.com", usuarios })!, /a ti mismo/);
  assert.match(errorDesactivar({ actor: "ventas@finbra.com", email: "otra@finbra.com", usuarios: [usuarios[1], usuarios[2]] })!, /al menos un Super Admin/);
  assert.equal(etiquetaRol("super_admin"), "Super Admin");
});
