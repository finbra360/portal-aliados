import test from "node:test";
import assert from "node:assert/strict";
import { colorDeTexto, contraste, getTierProgress, TIERS } from "./tiers.ts";

test("sin colocación está en el primer nivel, con el segundo como meta", () => {
  const p = getTierProgress(0);
  assert.equal(p.actual.id, TIERS[0].id);
  assert.equal(p.siguiente?.id, TIERS[1].id);
  assert.equal(p.progresoPct, 0);
  assert.equal(p.faltante, TIERS[1].umbral);
});

test("justo en el umbral ya cuenta como el nivel nuevo", () => {
  const p = getTierProgress(TIERS[1].umbral);
  assert.equal(p.actual.id, TIERS[1].id);
  assert.equal(p.progresoPct, 0);
});

test("a la mitad del camino entre dos niveles, 50 % y lo que falta", () => {
  const medio = TIERS[0].umbral + (TIERS[1].umbral - TIERS[0].umbral) / 2;
  const p = getTierProgress(medio);
  assert.equal(p.actual.id, TIERS[0].id);
  assert.equal(p.progresoPct, 50);
  assert.equal(p.faltante, TIERS[1].umbral - medio);
});

test("en el último nivel no hay siguiente ni falta nada", () => {
  const ultimo = TIERS[TIERS.length - 1];
  const p = getTierProgress(ultimo.umbral * 3);
  assert.equal(p.actual.id, ultimo.id);
  assert.equal(p.siguiente, null);
  assert.equal(p.progresoPct, 100);
  assert.equal(p.faltante, 0);
});

test("los niveles están en orden creciente de umbral y el primero empieza en 0", () => {
  assert.equal(TIERS[0].umbral, 0);
  for (let i = 1; i < TIERS.length; i++) assert.ok(TIERS[i].umbral > TIERS[i - 1].umbral);
});

test("contraste: blanco sobre negro es 21 y un color contra sí mismo es 1", () => {
  assert.equal(Math.round(contraste("#ffffff", "#000000")), 21);
  assert.equal(contraste("#5d5bdb", "#5d5bdb"), 1);
});

test("el texto de la insignia de cada nivel cumple AA (4.5) o es el mejor de los dos", () => {
  for (const t of TIERS) {
    const texto = colorDeTexto(t.color);
    const otro = texto === "#ffffff" ? "#1a1a1a" : "#ffffff";
    assert.ok(contraste(t.color, texto) >= contraste(t.color, otro), t.id);
    assert.ok(contraste(t.color, texto) >= 4.5, `${t.id}: contraste ${contraste(t.color, texto).toFixed(2)}`);
  }
});
