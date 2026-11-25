import { test } from "node:test";
import assert from "node:assert/strict";
import { compactarContactos, leerExportContactos, planContactos, type YaEnEmpresa } from "./hubspot-contactos.ts";

// Export ficticio, como lo baja HubSpot en español.
const EXPORT = [
  "ID de registro,Nombre,Apellidos,Correo,Número de teléfono,Número de teléfono móvil,Cargo,Nombre de la empresa,Propiedad que no sirve",
  "1,Ana,Ficticia Uno,Ana@Ejemplo.TEST,55 1111 2222,+52 55 3333 4444,Directora General,TALLERES EJEMPLO NORTE SA DE CV,x",
  "2,Beto,Ficticio,beto@ejemplo.test,,,Contador,Talleres Ejemplo Norte,x",
  "3,Carla,Ficticia,carla@ejemplo,5511112222,,,Empresa Que No Existe,x",
  "4,,,,,,,,x",
  "5,Dani,Sin Empresa,dani@ejemplo.test,,,,,x",
].join("\r\n");

test("export de contactos: nombre completo, correo válido, teléfonos a 10 dígitos sin repetir", () => {
  const r = leerExportContactos(EXPORT);
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.equal(r.filas.length, 5);
  assert.deepEqual(r.filas[0], {
    hubspotId: "1",
    nombre: "Ana Ficticia Uno",
    puesto: "Directora General",
    correo: "ana@ejemplo.test",
    telefonos: ["5511112222", "5533334444"],
    empresa: "TALLERES EJEMPLO NORTE SA DE CV",
  });
  assert.equal(r.filas[2].correo, null); // «carla@ejemplo» no es un correo.
  assert.equal(r.filas[3].nombre, "");
});

test("export de contactos: errores claros si no es el archivo correcto", () => {
  assert.equal(leerExportContactos("Nombre,Correo\nAna,a@b.test").ok, false);
  assert.deepEqual(leerExportContactos("ID de registro,Nombre del negocio\n1,X"), {
    ok: false,
    error: "El archivo no trae nombre ni correo. ¿Es el export de contactos? (el de negocios se sube en la otra pestaña).",
  });
  assert.deepEqual(leerExportContactos("Record ID,First Name,Email\n1,Ana,a@b.test"), {
    ok: false,
    error: "El archivo no trae la empresa de cada contacto. Exporta con la propiedad «Nombre de la empresa» o la empresa asociada.",
  });
});

test("compactar: solo las columnas que se usan, y se lee igual", () => {
  const c = compactarContactos(EXPORT);
  assert.ok(!c.includes("Propiedad que no sirve"));
  const r = leerExportContactos(c);
  assert.ok(r.ok && r.filas[0].nombre === "Ana Ficticia Uno" && r.filas.length === 5);
});

test("vista previa: empresa por nombre, ya existe por nombre o canal, y por qué no se importa", () => {
  const r = leerExportContactos(EXPORT);
  assert.ok(r.ok);
  if (!r.ok) return;
  const existentes = new Map<string, YaEnEmpresa>([["e1", { nombres: new Set(["beto ficticio"]), canales: new Set(["5533334444"]) }]]);
  const plan = planContactos(r.filas, { empresas: [{ id: "e1", nombre: "TALLERES EJEMPLO NORTE", razonSocial: null }], existentes });
  const por = Object.fromEntries(plan.map((p) => [p.fila.hubspotId, p]));
  // Ana: su empresa con otro tipo de sociedad; ya existe porque su celular ya está.
  assert.deepEqual(por["1"].empresa, { id: "e1", nombre: "TALLERES EJEMPLO NORTE" });
  assert.equal(por["1"].yaExiste, true);
  assert.equal(por["1"].marcado, false);
  // Beto: ya existe por nombre.
  assert.equal(por["2"].yaExiste, true);
  // Carla: su empresa no está en Clientes.
  assert.equal(por["3"].problema, "«Empresa Que No Existe» no está en Clientes.");
  assert.equal(por["4"].problema, "No trae nombre ni correo.");
  assert.equal(por["5"].problema, "No tiene empresa en HubSpot.");
  // Sin existentes, Ana se marca sola.
  const limpio = planContactos(r.filas, { empresas: [{ id: "e1", nombre: "TALLERES EJEMPLO NORTE", razonSocial: null }], existentes: new Map() });
  assert.equal(limpio.find((p) => p.fila.hubspotId === "1")!.marcado, true);
  assert.equal(limpio[0].problema, null); // Los importables van primero.
});

test("vista previa: un contacto repetido en el mismo archivo cuenta como que ya está", () => {
  const r = leerExportContactos("ID de registro,Nombre,Apellidos,Correo,Nombre de la empresa\n1,Beto,Ficticio,beto@ejemplo.test,Talleres Ejemplo Norte\n2,Beto,Ficticio,,TALLERES EJEMPLO NORTE SA");
  assert.ok(r.ok);
  if (!r.ok) return;
  const plan = planContactos(r.filas, { empresas: [{ id: "e1", nombre: "TALLERES EJEMPLO NORTE", razonSocial: null }], existentes: new Map() });
  const por = Object.fromEntries(plan.map((p) => [p.fila.hubspotId, p]));
  assert.equal(por["1"].yaExiste, false);
  assert.equal(por["1"].marcado, true);
  assert.equal(por["2"].yaExiste, true);
});
