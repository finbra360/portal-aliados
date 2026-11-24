import { test } from "node:test";
import assert from "node:assert/strict";
import { CAMPOS, diferencias, validarAjustes, valoresDe } from "./ajustes.ts";
import { AJUSTES_SALUD_DEFAULT, leerAjustesSalud } from "./salud.ts";
import { AJUSTES_PLAYBOOKS_DEFAULT, leerAjustesPlaybooks } from "./playbooks.ts";

const comoFormulario = (v: Record<string, number | boolean>) =>
  Object.fromEntries(Object.entries(v).flatMap(([k, x]) => (typeof x === "boolean" ? (x ? [[k, "on"]] : []) : [[k, String(x)]])));

test("cada campo existe en los ajustes y lo que se guarda lo vuelven a leer igual", () => {
  for (const [clave, def, leer] of [
    ["salud", AJUSTES_SALUD_DEFAULT, leerAjustesSalud],
    ["playbooks", AJUSTES_PLAYBOOKS_DEFAULT, leerAjustesPlaybooks],
  ] as const) {
    for (const c of CAMPOS[clave]) assert.ok(c.prop in def, `${clave}.${c.prop}`);
    const valores = valoresDe(clave, def);
    const r = validarAjustes(clave, comoFormulario(valores));
    assert.ok(r.ok, JSON.stringify(r));
    assert.deepEqual(leer(r.ok ? r.valor : null), def);
  }
  // Todos los ajustes de salud y de playbooks tienen campo en la pantalla.
  assert.equal(CAMPOS.salud.length, Object.keys(AJUSTES_SALUD_DEFAULT).length);
  assert.equal(CAMPOS.playbooks.length, Object.keys(AJUSTES_PLAYBOOKS_DEFAULT).length);
});

test("un cambio se guarda y se lee", () => {
  const f = comoFormulario(valoresDe("salud", AJUSTES_SALUD_DEFAULT));
  const r = validarAjustes("salud", { ...f, contacto_mas_90: "10" });
  assert.ok(r.ok);
  assert.equal(leerAjustesSalud(r.ok && r.valor).contactoMas90, 10);
});

test("rechaza números fuera de rango, vacíos o con decimales, con el nombre del campo", () => {
  const f = comoFormulario(valoresDe("salud", AJUSTES_SALUD_DEFAULT));
  assert.deepEqual(validarAjustes("salud", { ...f, atraso_leve: "120" }), { ok: false, error: "«Atraso leve resta» tiene que estar entre 0 y 100." });
  assert.deepEqual(validarAjustes("salud", { ...f, dato_faltante: "" }), { ok: false, error: "«Cada dato faltante resta» tiene que ser un número entero." });
  assert.deepEqual(validarAjustes("salud", { ...f, un_atraso: "2.5" }), { ok: false, error: "«Una vez atrasado resta» tiene que ser un número entero." });
});

test("los cortes y los tramos de atraso tienen que ir en orden", () => {
  const f = comoFormulario(valoresDe("salud", AJUSTES_SALUD_DEFAULT));
  assert.equal(validarAjustes("salud", { ...f, corte_atencion: "80" }).ok, false);
  assert.equal(validarAjustes("salud", { ...f, atraso_leve_dias: "30" }).ok, false);
});

test("casillas: sin marcar es apagado", () => {
  const f = comoFormulario(valoresDe("playbooks", AJUSTES_PLAYBOOKS_DEFAULT));
  delete f.rescate;
  const r = validarAjustes("playbooks", f);
  assert.ok(r.ok);
  assert.equal(r.ok && r.valor.rescate, false);
  assert.equal(r.ok && r.valor.activo, true);
});

test("diferencias: solo lo que cambió", () => {
  assert.deepEqual(diferencias({ a: 1, b: true }, { a: 2, b: true, c: 3 }), { a: { antes: 1, despues: 2 }, c: { antes: null, despues: 3 } });
});
