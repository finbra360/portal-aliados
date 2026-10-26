import { test } from "node:test";
import assert from "node:assert/strict";
import { resumirPersonalizado } from "./personalizado.ts";

// Forma del ejemplo XML de SIAC llevado a JSON (datos ficticios).
const credito = (no: string, monto?: number) => ({
  InformacionGeneral: { NoCredito: no, NumeroCliente: "000000001", Cliente: "CLIENTE FICTICIO" },
  CobranzaRespuesta: { ProximoVencimiento: "2026-10-19T00:00:00", MontoPorVencer: 4063416.05, ...(monto === undefined ? {} : { MontoSiguienteVencimiento: monto }) },
  Vencido: { TotalVencido: 0, TotalAdeudo: 4063416.05 },
});

test("resumen del Listado Personalizado: créditos a cualquier profundidad, paginación y muestra", () => {
  const r = resumirPersonalizado(
    {
      Detalle: "CORRECTO",
      PaginaActual: "1",
      PaginasTotales: 1,
      RegistrosPagina: 500,
      RegistrosTotales: 3,
      vListEntCredito: [{ ListadoCobranzaPersonalizado: { Cobranza: [{ CobranzaWsPersonalizado: credito("1109", 172665.64) }, { CobranzaWsPersonalizado: credito("1108", 41000) }, { CobranzaWsPersonalizado: credito("1107") }] } }],
    },
    "1109",
  );
  assert.equal(r.creditos, 3);
  assert.equal(r.conMontoSiguiente, 2);
  assert.deepEqual(r.paginacion, { paginaActual: 1, paginasTotales: 1, registrosPagina: 500, registrosTotales: 3 });
  assert.equal(r.ruta, "vListEntCredito[0].ListadoCobranzaPersonalizado.Cobranza[0].CobranzaWsPersonalizado");
  assert.deepEqual(r.secciones.InformacionGeneral, ["NoCredito", "NumeroCliente", "Cliente"]);
  assert.deepEqual(r.muestra, { noCredito: "1109", proximoVencimiento: "2026-10-19T00:00:00", montoSiguienteVencimiento: 172665.64 });
});

test("resumen: respuesta sin créditos", () => {
  const r = resumirPersonalizado({ Detalle: "No se encontraron registros" }, "1109");
  assert.equal(r.creditos, 0);
  assert.equal(r.muestra, null);
  assert.equal(r.ruta, null);
});
