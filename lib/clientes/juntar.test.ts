import { test } from "node:test";
import assert from "node:assert/strict";
import { empresasPorRevisar, sugerirEmpresas, validarJuntar, type EmpresaJuntar } from "./juntar.ts";

const e = (x: Partial<EmpresaJuntar> & { id: string; nombre: string }): EmpresaJuntar => ({ razonSocial: null, clientes: 0, negocios: 0, ...x });

const CLIENTE = e({ id: "c1", nombre: "TALLERES EJEMPLO NORTE SA DE CV", clientes: 1, negocios: 1 });
const PROSPECTO = e({ id: "p1", nombre: "Talleres Ejemplo Norte", negocios: 2 });
const OTRO_CLIENTE = e({ id: "c2", nombre: "COMERCIAL FICTICIA", clientes: 1 });

test("juntar: la que se borra no puede ser cliente de SIAC", () => {
  assert.deepEqual(validarJuntar(CLIENTE, PROSPECTO), { ok: true });
  assert.deepEqual(validarJuntar(PROSPECTO, e({ id: "p2", nombre: "Otro prospecto" })), { ok: true });
  assert.equal(validarJuntar(CLIENTE, CLIENTE).ok, false);
  assert.deepEqual(validarJuntar(PROSPECTO, CLIENTE), {
    ok: false,
    error: "TALLERES EJEMPLO NORTE SA DE CV es cliente de SIAC: júntala al revés (que TALLERES EJEMPLO NORTE SA DE CV se quede y Talleres Ejemplo Norte se borre).",
  });
  assert.deepEqual(validarJuntar(OTRO_CLIENTE, CLIENTE), { ok: false, error: "Las dos son clientes de SIAC. Cada razón social es un cliente aparte y no se juntan." });
});

test("sugerencias: por nombre o razón social, sin tipo de sociedad; las más parecidas primero", () => {
  const s = sugerirEmpresas(PROSPECTO, [CLIENTE, OTRO_CLIENTE, PROSPECTO, e({ id: "p3", nombre: "Talleres Sur" })]);
  assert.deepEqual(
    s.map((x) => [x.id, x.parecido, x.esCliente]),
    [["c1", 1, true]],
  );
  const porRazon = sugerirEmpresas(e({ id: "p4", nombre: "Comercial Ficticia" }), [e({ id: "c3", nombre: "CF", razonSocial: "COMERCIAL FICTICIA, S.A. DE C.V.", clientes: 1 })]);
  assert.equal(porRazon[0]?.id, "c3");
});

test("por revisar: solo prospectos con alguna empresa parecida y sin los ya revisados", () => {
  const todas = [CLIENTE, PROSPECTO, OTRO_CLIENTE, e({ id: "p5", nombre: "Panadería Única Ficticia" })];
  assert.deepEqual(
    empresasPorRevisar(todas, new Set()).map((x) => x.empresa.id),
    ["p1"],
  );
  assert.deepEqual(empresasPorRevisar(todas, new Set(["p1"])), []);
});
