import { test } from "node:test";
import assert from "node:assert/strict";
import { avisosDeCartera, plazoDe, validarTarea, type ClienteCartera } from "./tareas.ts";

const HOY = "2026-11-05";

test("tarea: título y fecha obligatorios, la fecha no puede ser anterior a hoy", () => {
  assert.equal(validarTarea({ venceEl: HOY }, HOY).ok, false);
  assert.equal(validarTarea({ titulo: "Llamar", venceEl: "" }, HOY).ok, false);
  assert.equal(validarTarea({ titulo: "Llamar", venceEl: "2026-11-04" }, HOY).ok, false);
  assert.equal(validarTarea({ titulo: "Llamar", venceEl: HOY, tipo: "urgente" }, HOY).ok, false);
  const r = validarTarea({ titulo: " Llamar para revisión ", venceEl: HOY, responsableEmail: "Laura@Finbra.test" }, HOY);
  assert.ok(r.ok);
  assert.deepEqual(r.datos, { titulo: "Llamar para revisión", tipo: "seguimiento", venceEl: HOY, responsableEmail: "laura@finbra.test", descripcion: null });
});

test("plazo de una tarea: vencida, hoy, en la semana o después", () => {
  assert.equal(plazoDe("2026-11-04", HOY), "vencida");
  assert.equal(plazoDe(HOY, HOY), "hoy");
  assert.equal(plazoDe("2026-11-12", HOY), "semana");
  assert.equal(plazoDe("2026-11-13", HOY), "despues");
});

const cliente = (over: Partial<ClienteCartera>): ClienteCartera => ({
  empresaId: "e",
  nombre: "Empresa",
  enMora: false,
  maxAtraso: 0,
  creditosVigentes: 1,
  tienePrincipal: true,
  ultimoContacto: "2026-11-01T16:00:00.000Z",
  ...over,
});

test("avisos de cartera: mora primero; sin contacto solo con crédito vigente", () => {
  const avisos = avisosDeCartera(
    [
      cliente({ empresaId: "ok", nombre: "Al día" }),
      cliente({ empresaId: "m", nombre: "Morosa", enMora: true, maxAtraso: 45 }),
      cliente({ empresaId: "s", nombre: "Silenciosa", ultimoContacto: "2026-08-01T16:00:00.000Z" }),
      cliente({ empresaId: "n", nombre: "Nunca", ultimoContacto: null }),
      cliente({ empresaId: "x", nombre: "Ex cliente", creditosVigentes: 0, ultimoContacto: null }),
      cliente({ empresaId: "d", nombre: "Datos", tienePrincipal: false }),
    ],
    HOY,
  );
  assert.deepEqual(
    avisos.map((a) => [a.empresaId, a.tipo]),
    [["m", "mora"], ["n", "sin_contacto"], ["s", "sin_contacto"], ["d", "sin_principal"]],
  );
  assert.equal(avisos[0].texto, "En mora: 45 días de atraso");
  assert.equal(avisos.find((a) => a.empresaId === "s")!.texto, "Sin contacto hace 95 días");
  assert.equal(avisos.find((a) => a.empresaId === "n")!.texto, "Sin contacto registrado");
});
