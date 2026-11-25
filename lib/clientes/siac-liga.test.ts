import { test } from "node:test";
import assert from "node:assert/strict";
import { comoJuntar, palabrasDe, parecidoNombre, sugerirCreditos, type CreditoSiac } from "./siac-liga.ts";

test("nombres: sin acentos, puntuación ni tipo de sociedad", () => {
  assert.deepEqual([...palabrasDe("Mudanzas Ficticias del Centro, S.A. de C.V.")], ["MUDANZAS", "FICTICIAS", "CENTRO"]);
  assert.equal(parecidoNombre("Mudanzas Ficticias del Centro", "MUDANZAS FICTICIAS DEL CENTRO SA DE CV"), 1);
  assert.equal(parecidoNombre("Constructora Ficticia del Sur", "CONSTRUCTORA FICTICIA NORTE"), 2 / 3);
  assert.equal(parecidoNombre("S.A. de C.V.", "Talleres"), 0);
});

const NEGOCIO = { empresaId: "e1", nombres: ["Mudanzas Ficticias del Centro"], monto: 1_200_000, dispersadoEl: "2026-11-20" };
const credito = (x: Partial<CreditoSiac>): CreditoSiac => ({
  creditId: "c",
  noCredito: "D1",
  cliente: "MUDANZAS FICTICIAS DEL CENTRO SA DE CV",
  numeroCliente: "000000900",
  empresaId: "e9",
  monto: 1_200_000,
  fechaMinistracion: "2026-11-21",
  ...x,
});

test("sugerencias: nombre, monto y fecha; de más a menos probable", () => {
  const r = sugerirCreditos(NEGOCIO, [
    credito({ creditId: "a", noCredito: "D1" }),
    credito({ creditId: "b", noCredito: "D2", cliente: "TALLERES EJEMPLO NORTE", monto: 1_190_000 }),
    credito({ creditId: "c", noCredito: "D3", monto: 900_000, fechaMinistracion: "2026-12-10" }),
  ]);
  assert.deepEqual(
    r.map((s) => [s.creditId, s.puntos]),
    [
      ["a", 100],
      ["c", 70],
      // Otro nombre, pero mismo monto y fecha: sale al final, por si SIAC lo escribió distinto.
      ["b", 50],
    ],
  );
  assert.deepEqual(r[0].razones, ["mismo nombre", "mismo monto", "ministrado el 21 nov"]);
  assert.equal(r[1].razones[1], "monto 25 % distinto");
});

test("sugerencias: fuera de la ventana no salen, salvo los de la misma empresa", () => {
  assert.equal(sugerirCreditos(NEGOCIO, [credito({ fechaMinistracion: "2026-06-01" })]).length, 0);
  const r = sugerirCreditos(NEGOCIO, [credito({ empresaId: "e1", cliente: "OTRO NOMBRE", fechaMinistracion: "2026-06-01", monto: 500_000 })]);
  assert.equal(r.length, 1);
  assert.equal(r[0].razones[0], "es de la misma empresa");
});

test("sugerencias: a lo más cinco", () => {
  const muchos = Array.from({ length: 8 }, (_, i) => credito({ creditId: `x${i}`, noCredito: `D${i}` }));
  assert.equal(sugerirCreditos(NEGOCIO, muchos).length, 5);
});

test("juntar empresas: solo un prospecto con la empresa que creó SIAC", () => {
  const prospecto = { id: "p", nombre: "Mudanzas", origen: "manual" as const, clientes: 0 };
  const deSiac = { id: "s", nombre: "MUDANZAS SA", origen: "siac" as const, clientes: 1 };
  assert.deepEqual(comoJuntar(prospecto, deSiac), { ok: true, accion: "juntar" });
  assert.deepEqual(comoJuntar(deSiac, deSiac), { ok: true, accion: "misma" });
  assert.equal(comoJuntar({ ...prospecto, clientes: 1 }, deSiac).ok, false);
  assert.equal(comoJuntar(prospecto, { ...deSiac, origen: "manual" }).ok, false);
});
