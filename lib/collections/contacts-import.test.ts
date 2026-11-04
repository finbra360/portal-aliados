import { test } from "node:test";
import assert from "node:assert/strict";
import { revisarContactos, tipoDesdeTexto, type FilaContacto } from "./contacts-import.ts";

const CLIENTES = [
  { id: "a", numeroCliente: "000000101", nombre: "LOGÍSTICA DEL BAJÍO S.A. DE C.V." },
  { id: "b", numeroCliente: "000000102", nombre: "TRANSPORTES NORTE SA DE CV" },
  { id: "c", numeroCliente: "000000103", nombre: "AGRO OCCIDENTE" },
  { id: "d", numeroCliente: "000000104", nombre: "AGRO OCCIDENTE" },
];
const CREDITOS = [
  { noCredito: "1008 R", clientId: "a" },
  { noCredito: "1010", clientId: "b" },
];
const EXISTENTES = [{ clientId: "a", valor: "55 1111 2222", telefonoWhatsapp: "525511112222" }];

const revisar = (texto: string) => {
  const r = revisarContactos(texto, CLIENTES, CREDITOS, EXISTENTES);
  if ("error" in r) throw new Error(r.error);
  return r.filas;
};
const resumen = (f: FilaContacto) => `${f.fila}:${f.estado}:${f.clientId ?? "-"}:${f.medio ?? "-"}`;

test("encuentra al cliente por número (sin ceros), crédito o razón social", () => {
  const filas = revisar(
    "Número de cliente\tCrédito\tCliente\tNombre\tTeléfono\n" +
      "101\t\t\tAna\t5533334444\n" +
      "\t1010\t\tLuis\t5544445555\n" +
      "\t\tTransportes Norte, S.A. de C.V.\tEva\t5555556666\n" +
      "\t\tLogistica del Bajio SA de CV\tIvo\t+52 55 6666 7777\n",
  );
  assert.deepEqual(filas.map(resumen), ["2:nuevo:a:telefono", "3:nuevo:b:telefono", "4:nuevo:b:telefono", "5:nuevo:a:telefono"]);
  assert.equal(filas[3].telefonoWhatsapp, "525566667777");
});

test("errores al encontrar al cliente", () => {
  const filas = revisar(
    "Numero de cliente,Credito,Cliente,Telefono\n" +
      "999,,,5533334444\n" +
      ",,Agro Occidente,5533334444\n" +
      "101,1010,,5533334444\n" +
      ",,,5533334444\n",
  );
  assert.deepEqual(filas.map((f) => f.estado), ["error", "error", "error", "error"]);
  assert.match(filas[0].detalle!, /No encontramos el número de cliente 999/);
  assert.match(filas[1].detalle!, /más de un cliente que se llama así/);
  assert.match(filas[2].detalle!, /No coinciden/);
  assert.match(filas[3].detalle!, /Falta el número de cliente/);
});

test("teléfono y correo en la misma fila dan dos contactos; ya existentes y repetidos", () => {
  const filas = revisar(
    "Numero de cliente,Nombre,Telefono,Correo,Tipo\n" +
      "101,Ana,5533334444,Ana@Ejemplo.MX,Tesorería\n" +
      "101,Ya estaba,(55) 1111-2222,,\n" +
      "101,Repetida,55 3333 4444,,\n" +
      "102,Mal,12345,no-es-correo,Contador\n",
  );
  assert.deepEqual(filas.map(resumen), ["2:nuevo:a:telefono", "2:nuevo:a:email", "3:existe:a:telefono", "4:error:a:telefono", "5:error:b:telefono", "5:error:b:email"]);
  assert.equal(filas[1].valor, "ana@ejemplo.mx");
  assert.equal(filas[0].tipoContacto, "pagos");
  assert.match(filas[3].detalle!, /Repetido en el archivo \(fila 2\)/);
  assert.equal(filas[4].tipoContacto, "contabilidad");
});

test("recordatorios: solo un teléfono del deudor, uno por cliente", () => {
  const filas = revisar(
    "Numero de cliente,Telefono,Correo,Tipo,Recordatorios\n" +
      "101,5533334444,a@ejemplo.mx,Dueño,Sí\n" +
      "101,5544445555,,Pagos,x\n" +
      "102,5544445555,,Aval,si\n" +
      "102,,b@ejemplo.mx,,si\n" +
      "102,5577778888,,,quizá\n" +
      "102,5577778888,,Jefe,\n",
  );
  assert.deepEqual(filas.map((f) => [f.estado, f.usarParaRecordatorios]), [
    ["nuevo", true],
    ["nuevo", false],
    ["error", true],
    ["error", false],
    ["error", false],
    ["error", false],
    ["error", false],
  ]);
  assert.match(filas[2].detalle!, /Solo un contacto por cliente/);
  assert.match(filas[3].detalle!, /aval o una referencia/);
  assert.match(filas[4].detalle!, /necesita teléfono/);
  assert.match(filas[5].detalle!, /Sí o No/);
  assert.match(filas[6].detalle!, /Tipo "Jefe" no válido/);
});

test("encabezados obligatorios y límites", () => {
  assert.deepEqual(revisarContactos("Nombre,Telefono\nAna,5533334444", CLIENTES, CREDITOS, []), {
    error: 'Falta la columna que dice de qué cliente es cada contacto: "Número de cliente", "Crédito" o "Cliente". Llegó: Nombre, Telefono',
  });
  assert.match((revisarContactos("Numero de cliente,Nombre\n101,Ana", CLIENTES, CREDITOS, []) as { error: string }).error, /Teléfono" o "Correo/);
  assert.match((revisarContactos("Numero de cliente,Telefono\n", CLIENTES, CREDITOS, []) as { error: string }).error, /no trae contactos/);
});

test("tipos por texto", () => {
  assert.equal(tipoDesdeTexto("Representante legal"), "dueno");
  assert.equal(tipoDesdeTexto("Dueño o representante legal"), "dueno");
  assert.equal(tipoDesdeTexto("  "), "deudor");
  assert.equal(tipoDesdeTexto("REFERENCIA"), "referencia");
  assert.equal(tipoDesdeTexto("Gerente"), null);
});
