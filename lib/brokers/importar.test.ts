import { test } from "node:test";
import assert from "node:assert/strict";
import { asignarIds, leerTabla, mapearColumnas, normalizarId, normalizarTelefono, revisarImportacion, siguienteId, validarBroker } from "./importar.ts";

test("IDs: el siguiente libre, con tres dígitos", () => {
  assert.equal(siguienteId([]), "B001");
  assert.equal(siguienteId(["B001", "B002"]), "B003");
  assert.equal(siguienteId(["B001", "B010", "OTRO"]), "B011", "respeta huecos y descarta formatos raros");
  assert.equal(siguienteId(["B999"]), "B1000");
});

test("validar un broker", () => {
  assert.deepEqual(validarBroker({ email: "  Ana.Perez@Ejemplo.MX ", nombre: " Ana   Pérez ", telefono: "+52 55 1234 5678" }), {
    ok: true,
    email: "ana.perez@ejemplo.mx",
    nombre: "Ana Pérez",
    telefono: "5512345678",
  });
  assert.equal(validarBroker({ email: "ana@x", nombre: "Ana" }).ok, false);
  assert.equal(validarBroker({ email: "ana@x.mx", nombre: "  " }).ok, false);
  assert.match((validarBroker({ email: "ana@x.mx", nombre: "Ana", telefono: "123" }) as { error: string }).error, /10 dígitos/);
  assert.deepEqual(normalizarTelefono(""), { ok: true, telefono: null });
});

test("leer CSV con comillas y texto pegado desde Excel", () => {
  assert.deepEqual(leerTabla('Email,Nombre\r\nana@x.mx,"Pérez, Ana"\r\n'), [["Email", "Nombre"], ["ana@x.mx", "Pérez, Ana"]]);
  assert.deepEqual(leerTabla("Correo\tNombre completo\tCelular\nana@x.mx\tAna\t5512345678\n\n"), [["Correo", "Nombre completo", "Celular"], ["ana@x.mx", "Ana", "5512345678"]]);
  assert.deepEqual(leerTabla("﻿Email;Nombre\nana@x.mx;Ana"), [["Email", "Nombre"], ["ana@x.mx", "Ana"]], "punto y coma y BOM de Excel");
});

test("reconocer columnas por su encabezado", () => {
  assert.deepEqual(mapearColumnas(["Nombre completo", "Correo electrónico", "Teléfono"]), { email: 1, nombre: 0, telefono: 2, id: -1 });
  assert.deepEqual(mapearColumnas(["Email", "Nombre"]), { email: 0, nombre: 1, telefono: -1, id: -1 });
  assert.match((mapearColumnas(["A", "B"]) as { error: string }).error, /Email.*Nombre/);
});

test("revisar una carga: nuevos, ya existentes, repetidos y errores", () => {
  const existentes = new Map([["b001@finbra.test", "B001"]]);
  const r = revisarImportacion(
    "Email,Nombre,Telefono\nnuevo@x.mx,Nuevo Uno,5511112222\nB001@finbra.test,Ya Existe,\nmal-correo,Sin Correo,\nnuevo@x.mx,Repetido,\notro@x.mx,Otro,12\n",
    existentes,
  );
  assert.ok("filas" in r);
  assert.deepEqual(
    r.filas.map((f) => `${f.fila}:${f.estado}:${f.detalle ?? ""}`),
    ["2:nuevo:", "3:existe:B001", "4:error:El correo no es válido", "5:error:Correo repetido en el archivo (fila 2)", "6:error:El teléfono debe tener 10 dígitos"],
  );
  assert.match((revisarImportacion("Email,Nombre\n", existentes) as { error: string }).error, /no trae filas/);
});

test("columna de ID opcional: respeta los del Sheet y valida choques", () => {
  const existentes = new Map([["b001@finbra.test", "B001"]]);
  const r = revisarImportacion(
    [
      "Email,Nombre completo,ID Broker",
      "b001@finbra.test,Ya Existe,B001", // mismo ID: existe
      "b002@finbra.test,Del Sheet,b2", // se normaliza a B002
      "otro@x.mx,Choca,B001", // ID de otro correo
      "b001@finbra.test,Otro ID,B009", // correo existente con ID distinto
      "sin@x.mx,Sin ID,",
      "mal@x.mx,ID raro,FAP BR/44",
      "dup@x.mx,ID repetido,B002",
    ].join("\n"),
    existentes,
  );
  assert.ok("filas" in r);
  assert.deepEqual(
    r.filas.map((f) => `${f.estado}:${f.id ?? ""}:${f.detalle ?? ""}`),
    [
      "existe:B001:B001",
      "nuevo:B002:",
      "error:B001:El ID B001 ya es de b001@finbra.test",
      "error:B009:Ese correo ya está dado de alta como B001",
      "nuevo::",
      "error:FAP BR/44:El ID solo puede llevar letras, números y guiones (por ejemplo FAPBR044)",
      "error:B002:ID repetido en el archivo (fila 3)",
    ],
  );
});

test("asignar IDs: los del archivo se respetan y los demás siguen la numeración", () => {
  const ids = asignarIds([{ id: null }, { id: "B005" }, { id: null }], ["B001", "B002"]).map((b) => b.id);
  assert.deepEqual(ids, ["B006", "B005", "B007"]);
  assert.equal(normalizarId(" b7 "), "B007");
  assert.equal(normalizarId(" fapbr044 "), "FAPBR044", "código de Lendia");
  assert.equal(normalizarId("FAP BR44"), "error");
  assert.equal(normalizarId(""), null);
});

test("códigos de Lendia como ID, mezclados con B### generados", () => {
  const r = revisarImportacion("Correo,Nombre,Telefono,ID\nana@x.mx,Ana,6563229475,FAPBR044\nbeto@x.mx,Beto,,FAPBR044\ncarla@x.mx,Carla,,\n", new Map());
  assert.ok("filas" in r);
  assert.deepEqual(r.filas.map((f) => `${f.estado}:${f.id ?? ""}`), ["nuevo:FAPBR044", "error:FAPBR044", "nuevo:"]);
  const nuevos = r.filas.filter((f) => f.estado === "nuevo");
  assert.deepEqual(asignarIds(nuevos, ["B001", "B002"]).map((b) => b.id), ["FAPBR044", "B003"], "los FAPBR no cuentan para la numeración B###");
});
