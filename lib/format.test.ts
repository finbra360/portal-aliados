import test from "node:test";
import assert from "node:assert/strict";
import { formatCurrency, formatFecha, formatMoney, formatPercent, formatTelefono, formatValorConcurso } from "./format.ts";

// Intl usa espacios de no separación entre el símbolo y la cifra según la versión de ICU.
const limpio = (s: string) => s.replace(/ /g, " ");

test("pesos sin centavos, con separador de miles", () => {
  assert.equal(limpio(formatCurrency(1234567)), "$1,234,567");
  assert.equal(limpio(formatCurrency(0)), "$0");
});

test("pesos con centavos para cobranza", () => {
  assert.equal(limpio(formatMoney(1234.5)), "$1,234.50");
});

test("porcentaje con signo solo cuando es positivo", () => {
  assert.equal(formatPercent(12.4), "+12%");
  assert.equal(formatPercent(-5), "-5%");
  assert.equal(formatPercent(0), "0%");
});

test("fecha en español sin zona horaria", () => {
  assert.equal(formatFecha("2026-09-30"), "30 sep 2026");
  assert.equal(formatFecha("2026-01-05"), "5 ene 2026");
  assert.equal(formatFecha(null), "—");
});

test("teléfono mexicano de 10 dígitos, con o sin lada 52", () => {
  assert.equal(formatTelefono("5511112222"), "+52 55 1111 2222");
  assert.equal(formatTelefono("525511112222"), "+52 55 1111 2222");
  assert.equal(formatTelefono("123"), "123");
  assert.equal(formatTelefono(null), "");
});

test("valor de concurso: pesos u operaciones, con singular y plural", () => {
  assert.equal(limpio(formatValorConcurso("monto", 800000)), "$800,000");
  assert.equal(formatValorConcurso("operaciones", 1), "1 operación");
  assert.equal(formatValorConcurso("operaciones", 3), "3 operaciones");
});
