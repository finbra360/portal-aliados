import { test } from "node:test";
import assert from "node:assert/strict";
import { unirHistorial, validarActividad, validarPersona } from "./personas.ts";

test("persona: nombre obligatorio, catálogos válidos, y un contacto no vigente no puede ser el principal", () => {
  assert.equal(validarPersona({ nombre: "  " }).ok, false);
  assert.equal(validarPersona({ nombre: "Ana", rolDecision: "jefa" }).ok, false);
  assert.equal(validarPersona({ nombre: "Ana", canalPreferido: "fax" }).ok, false);
  const r = validarPersona({ nombre: " Ana Ejemplo ", puesto: "Directora de finanzas", rolDecision: "decide", canalPreferido: "whatsapp", esPrincipal: "on" });
  assert.ok(r.ok);
  assert.deepEqual(r.datos, {
    nombre: "Ana Ejemplo",
    puesto: "Directora de finanzas",
    rolDecision: "decide",
    esRepresentanteLegal: false,
    canalPreferido: "whatsapp",
    horarioPreferido: null,
    esPrincipal: true,
    vigente: true,
    notas: null,
  });
  const baja = validarPersona({ nombre: "Ana", esPrincipal: "on", vigente: "false" });
  assert.ok(baja.ok && baja.datos.esPrincipal === false && baja.datos.vigente === false);
});

test("actividad: tipo obligatorio, la nota necesita texto y no lleva resultado, y no puede estar en el futuro", () => {
  const ahora = new Date("2026-11-05T18:00:00Z"); // 12:00 en CDMX
  assert.equal(validarActividad({}, ahora).ok, false);
  assert.equal(validarActividad({ tipo: "nota" }, ahora).ok, false);
  const nota = validarActividad({ tipo: "nota", descripcion: "Pide factura por correo", resultado: "contesto" }, ahora);
  assert.ok(nota.ok && nota.datos.resultado === null && nota.datos.ocurridoAt === ahora.toISOString());
  const llamada = validarActividad({ tipo: "llamada", resultado: "interesado", ocurrido: "2026-11-05T09:30" }, ahora);
  assert.ok(llamada.ok);
  assert.equal(llamada.datos.ocurridoAt, "2026-11-05T15:30:00.000Z", "09:30 en CDMX = 15:30 UTC");
  assert.equal(validarActividad({ tipo: "llamada", ocurrido: "2026-11-05T14:00" }, ahora).ok, false, "dos horas en el futuro");
  assert.equal(validarActividad({ tipo: "llamada", resultado: "tal vez" }, ahora).ok, false);
});

test("historial: une comercial y cobranza, separa lo de SIAC y ordena del más reciente al más viejo", () => {
  const h = unirHistorial(
    [{ id: "1", tipo: "llamada", resultado: "interesado", descripcion: "Quiere renovar", actor: "laura@finbra.test", persona: "Ana", ocurridoAt: "2026-11-04T16:00:00.000Z" }],
    [
      { id: "10", tipo: "pago_detectado", etiqueta: "Pago", descripcion: "SIAC registró un pago", actor: "sistema", ocurridoAt: "2026-11-05T12:00:00.000Z" },
      { id: "11", tipo: "llamada", etiqueta: "Llamada", descripcion: "No contestó", actor: "cobranza@finbra.test", ocurridoAt: "2026-11-03T16:00:00.000Z" },
    ],
  );
  assert.deepEqual(h.map((e) => [e.id, e.origen]), [["k10", "siac"], ["c1", "comercial"], ["k11", "cobranza"]]);
  assert.equal(h[0].actor, null, "lo que hizo el sistema no tiene autor");
  assert.equal(h[1].tipo, "Llamada");
  assert.equal(h[1].resultado, "Interesado");
  assert.deepEqual(unirHistorial([], [{ id: "10", tipo: "pago_detectado", etiqueta: "Pago", descripcion: null, actor: "sistema", ocurridoAt: "2026-11-05T12:00:00.000Z" }], "cobranza"), []);
});
