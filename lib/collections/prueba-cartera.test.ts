import { test } from "node:test";
import assert from "node:assert/strict";
import { resumirRespuestaSiac } from "./prueba-cartera.ts";

// Formatos inventados: el real de SIAC todavía no se conoce. Datos ficticios.
const CONOCIDOS = { creditosVigentes: new Set(["1001", "1002"]), clientes: new Set(["000000101"]) };

test("encuentra la lista principal aunque venga anidada y reconoce los campos por nombre", () => {
  const r = resumirRespuestaSiac(
    {
      Detalle: "CORRECTO",
      PaginasTotales: 3,
      Datos: [
        {
          Creditos: [
            { NoControl: "1001", General: { IDCliente: "101", RFC: "AAA010101AA1" }, Estatus: "VIGENTE", FechaMinistracion: "2024-01-10", FechaLiquidacion: null },
            { NoControl: "0900", General: { IDCliente: "102", RFC: "" }, Estatus: "LIQUIDADO", FechaMinistracion: "2022-03-01", FechaLiquidacion: "2023-03-01" },
            { NoControl: "0901", General: { IDCliente: "103", RFC: "CCC010101CC3" }, Estatus: "LIQUIDADO", FechaMinistracion: "2021-05-01", FechaLiquidacion: "2022-05-01" },
          ],
        },
      ],
    },
    CONOCIDOS,
  );
  assert.equal(r.detalle, "CORRECTO");
  assert.equal(r.registros, 3);
  assert.deepEqual(r.campos, ["NoControl", "General.IDCliente", "General.RFC", "Estatus", "FechaMinistracion", "FechaLiquidacion"]);
  assert.equal(r.campoCredito, "NoControl");
  assert.equal(r.campoCliente, "General.IDCliente");
  assert.equal(r.campoRfc, "General.RFC");
  assert.equal(r.conRfc, 2);
  assert.deepEqual(r.estatus, [{ valor: "LIQUIDADO", n: 2 }, { valor: "VIGENTE", n: 1 }]);
  assert.deepEqual(r.camposFecha, ["FechaMinistracion", "FechaLiquidacion"]);
  assert.equal(r.creditosFueraDelListado, 2, "0900 y 0901 no están en el listado de hoy");
  assert.equal(r.clientesNuevos, 2, "101 ya lo tenemos aunque SIAC lo mande sin ceros");
  assert.deepEqual(r.sobre, { PaginasTotales: 3 });
});

test("si no reconoce los campos, no inventa conteos", () => {
  const r = resumirRespuestaSiac({ Detalle: "CORRECTO", Lista: [{ A: 1, B: "x" }] }, CONOCIDOS);
  assert.equal(r.registros, 1);
  assert.equal(r.campoCredito, null);
  assert.equal(r.creditosFueraDelListado, null);
  assert.equal(r.clientesNuevos, null);
  assert.deepEqual(r.estatus, []);
});

test("una respuesta de error queda con su detalle y sin registros", () => {
  const r = resumirRespuestaSiac({ Detalle: "Servicio no contratado" }, CONOCIDOS);
  assert.equal(r.detalle, "Servicio no contratado");
  assert.equal(r.registros, 0);
  assert.deepEqual(r.campos, []);
});
