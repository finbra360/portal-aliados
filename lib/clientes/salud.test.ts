import { test } from "node:test";
import assert from "node:assert/strict";
import { AJUSTES_SALUD_DEFAULT, calcularSalud, compararSalud, leerAjustesSalud, senalesDe, type SenalesSalud } from "./salud.ts";

const HOY = "2026-11-24";
const A = AJUSTES_SALUD_DEFAULT;

/** Al corriente, contactado hace 20 días, con datos completos y cliente desde hace tiempo. */
const sana = (over: Partial<SenalesSalud> = {}): SenalesSalud => ({
  creditosVigentes: 1,
  atrasoDias: 0,
  enMora: false,
  cobranzaEspecial: false,
  tienePrincipal: true,
  ultimoContacto: "2026-11-04T17:00:00.000Z",
  cuentaPago: true,
  whatsappValido: true,
  atrasosRecientes: 0,
  promesasIncumplidas: 0,
  clienteDesde: "2025-03-01",
  ...over,
});

test("sin señales: 100 puntos y Sana, sin razones", () => {
  assert.deepEqual(calcularSalud(sana(), A, HOY), { puntos: 100, nivel: "sana", razones: [] });
});

test("sin créditos vigentes no lleva salud", () => {
  assert.equal(calcularSalud(sana({ creditosVigentes: 0 }), A, HOY), null);
});

test("ejemplos del diseño", () => {
  // Nunca contactado y sin contacto principal: 100 − 25 − 5.
  const s1 = calcularSalud(sana({ ultimoContacto: null, tienePrincipal: false }), A, HOY)!;
  assert.equal(s1.puntos, 70);
  assert.equal(s1.nivel, "atencion");
  assert.deepEqual(
    s1.razones.map((r) => r.texto),
    ["Sin contacto registrado del equipo", "Sin contacto principal"],
  );

  // 5 días de atraso (su entrada a mora de este mes no resta dos veces).
  const s2 = calcularSalud(sana({ atrasoDias: 5, enMora: true, atrasosRecientes: 1 }), A, HOY)!;
  assert.equal(s2.puntos, 75);
  assert.equal(s2.nivel, "atencion");
  assert.deepEqual(s2.razones, [{ texto: "5 días de atraso hoy", puntos: 25 }]);

  // 12 días de atraso.
  const s3 = calcularSalud(sana({ atrasoDias: 12, enMora: true, atrasosRecientes: 1 }), A, HOY)!;
  assert.equal(s3.puntos, 55);
  assert.equal(s3.nivel, "riesgo");

  // Paga, pero se atrasó 2 veces este trimestre.
  const s4 = calcularSalud(sana({ atrasosRecientes: 2 }), A, HOY)!;
  assert.equal(s4.puntos, 75);
  assert.deepEqual(s4.razones, [{ texto: "Se atrasó 2 veces en los últimos 90 días", puntos: 25 }]);
});

test("más de 30 días de atraso o cobranza especial dejan al cliente En riesgo aunque todo lo demás esté bien", () => {
  assert.equal(calcularSalud(sana({ atrasoDias: 31, enMora: true, atrasosRecientes: 1 }), A, HOY)!.nivel, "riesgo");
  const e = calcularSalud(sana({ cobranzaEspecial: true }), A, HOY)!;
  assert.equal(e.puntos, 40);
  assert.equal(e.nivel, "riesgo");
});

test("atraso por debajo del umbral de mora (residuo) no resta como atraso de hoy", () => {
  const s = calcularSalud(sana({ atrasoDias: 3, enMora: false, atrasosRecientes: 1 }), A, HOY)!;
  assert.equal(s.puntos, 100);
});

test("atrasos anteriores al de hoy sí restan, con el texto que lo aclara", () => {
  const s = calcularSalud(sana({ atrasoDias: 4, enMora: true, atrasosRecientes: 2 }), A, HOY)!;
  assert.equal(s.puntos, 65);
  assert.ok(s.razones.some((r) => r.texto === "Antes de este atraso, se atrasó 1 vez en los últimos 90 días" && r.puntos === 10));
});

test("promesas incumplidas restan una sola vez", () => {
  const s = calcularSalud(sana({ promesasIncumplidas: 3 }), A, HOY)!;
  assert.deepEqual(s.razones, [{ texto: "3 promesas de pago incumplidas en los últimos 60 días", puntos: 15 }]);
});

test("contacto por tramos: 30 días no resta, 31 resta 5, 61 resta 15, 91 resta 25", () => {
  const conContacto = (fecha: string) => calcularSalud(sana({ ultimoContacto: `${fecha}T12:00:00.000Z` }), A, HOY)!.puntos;
  assert.equal(conContacto("2026-10-25"), 100);
  assert.equal(conContacto("2026-10-24"), 95);
  assert.equal(conContacto("2026-09-24"), 85);
  assert.equal(conContacto("2026-08-25"), 75);
});

test("en sus primeros 30 días como cliente la falta de contacto no resta", () => {
  assert.equal(calcularSalud(sana({ ultimoContacto: null, clienteDesde: "2026-11-10" }), A, HOY)!.puntos, 100);
  assert.equal(calcularSalud(sana({ ultimoContacto: null, clienteDesde: "2026-10-01" }), A, HOY)!.puntos, 75);
});

test("cada dato faltante resta 5", () => {
  const s = calcularSalud(sana({ tienePrincipal: false, cuentaPago: false, whatsappValido: false }), A, HOY)!;
  assert.equal(s.puntos, 85);
  assert.equal(s.razones.length, 3);
});

test("los puntos nunca bajan de 0 y las razones van de mayor a menor", () => {
  const s = calcularSalud(
    sana({ cobranzaEspecial: true, atrasoDias: 90, enMora: true, atrasosRecientes: 4, promesasIncumplidas: 1, ultimoContacto: null, tienePrincipal: false }),
    A,
    HOY,
  )!;
  assert.equal(s.puntos, 0);
  assert.deepEqual(
    s.razones.map((r) => r.puntos),
    [...s.razones.map((r) => r.puntos)].sort((a, b) => b - a),
  );
});

test("leerAjustesSalud: toma enteros válidos y descarta lo demás", () => {
  assert.deepEqual(leerAjustesSalud(null), A);
  const a = leerAjustesSalud({ corte_sana: 85, atraso_leve: "30", dato_faltante: -1, contacto_mas_90: 2.5, ventana_atrasos_dias: 1000 });
  assert.equal(a.corteSana, 85);
  assert.equal(a.atrasoLeve, 30);
  assert.equal(a.datoFaltante, A.datoFaltante);
  assert.equal(a.contactoMas90, A.contactoMas90);
  assert.equal(a.ventanaAtrasosDias, A.ventanaAtrasosDias);
  // Cortes al revés: se usan los de omisión.
  const b = leerAjustesSalud({ corte_sana: 50, corte_atencion: 70 });
  assert.equal(b.corteSana, A.corteSana);
  assert.equal(b.corteAtencion, A.corteAtencion);
});

test("senalesDe toma atraso, mora y cobranza especial de la fila de la lista", () => {
  const s = senalesDe({ creditosVigentes: 2, maxAtraso: 9, enMora: true, etapa: "cobranza_especial" }, undefined);
  assert.equal(s.atrasoDias, 9);
  assert.equal(s.enMora, true);
  assert.equal(s.cobranzaEspecial, true);
  assert.equal(s.tienePrincipal, false);
});

test("compararSalud: peor primero y sin salud al final", () => {
  const x = calcularSalud(sana({ atrasosRecientes: 2 }), A, HOY);
  const y = calcularSalud(sana(), A, HOY);
  assert.deepEqual([y, null, x].sort(compararSalud), [x, y, null]);
});
