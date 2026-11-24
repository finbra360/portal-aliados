import { test } from "node:test";
import assert from "node:assert/strict";
import { avisosDeCartera, plazoDe, validarTarea } from "./tareas.ts";
import type { Salud, SenalSalud } from "./salud.ts";

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

const salud = (puntos: number, nivel: "sana" | "atencion" | "riesgo", ...razones: [SenalSalud, string][]): Salud => ({
  puntos,
  nivel,
  razones: razones.map(([senal, texto]) => ({ senal, texto, puntos: 5 })),
});

test("avisos de cartera: solo Atención y En riesgo, del peor al mejor, con la pestaña donde se atiende", () => {
  const avisos = avisosDeCartera([
    { empresaId: "ok", nombre: "Sana", salud: salud(100, "sana") },
    { empresaId: "ex", nombre: "Ex cliente", salud: null },
    { empresaId: "c", nombre: "Callada", salud: salud(70, "atencion", ["contacto", "Sin contacto registrado del equipo"], ["datos", "Sin contacto principal"]) },
    { empresaId: "m", nombre: "Morosa", salud: salud(55, "riesgo", ["pago", "12 días de atraso hoy"]) },
    { empresaId: "d", nombre: "Datos", salud: salud(75, "atencion", ["datos", "Sin contacto principal"]) },
  ]);
  assert.deepEqual(
    avisos.map((a) => [a.empresaId, a.salud.nivel, a.pestana]),
    [
      ["m", "riesgo", ""],
      ["c", "atencion", "actividad"],
      ["d", "atencion", "contactos"],
    ],
  );
});
