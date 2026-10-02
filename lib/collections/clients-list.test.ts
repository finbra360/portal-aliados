import { test } from "node:test";
import assert from "node:assert/strict";
import { buildClientList, type ClientListRow } from "./clients-list.ts";
import type { ContactLike } from "./contacts.ts";

const fila = (over: Partial<ClientListRow>): ClientListRow => ({
  clientId: "c",
  nombre: "EMPRESA FICTICIA",
  numeroCliente: "000000100",
  creditosActivos: 1,
  adeudo: 100_000,
  vencido: 0,
  maxAtraso: 0,
  ultimoPago: null,
  pausaHasta: null,
  juridico: false,
  contactoCobranzaId: null,
  cuentaPagoId: "cuenta-1",
  ...over,
});

const tel = (clientId: string, id: string, over: Partial<ContactLike & { valor: string; nombre: string | null }> = {}) => ({
  id,
  clientId,
  valor: "5511112222",
  nombre: null,
  relacion: "titular" as const,
  rol: null,
  tipo: "telefono" as const,
  telefonoWhatsapp: "525511112222",
  estatus: "activo" as const,
  bajaWhatsappAt: null,
  esPrincipal: true,
  ...over,
});

const ROWS = [
  fila({ clientId: "a", nombre: "LOGÍSTICA DEL BAJÍO", numeroCliente: "000000101", vencido: 50_000, maxAtraso: 40 }),
  fila({ clientId: "b", nombre: "Transportes Norte", numeroCliente: "000000102", vencido: 600, cuentaPagoId: null }),
  fila({ clientId: "c", nombre: "Agro Occidente", numeroCliente: "000000103", vencido: 0, adeudo: 900_000 }),
  fila({ clientId: "d", nombre: "Sin créditos", numeroCliente: "000000104", creditosActivos: 0, adeudo: 0, cuentaPagoId: null }),
];
const CONTACTOS = [tel("a", "a1"), tel("b", "b1", { telefonoWhatsapp: null }), tel("c", "c1"), tel("c", "c2", { esPrincipal: false, valor: "5533334444", nombre: "Contador" })];

test("filtros y conteos", () => {
  const r = buildClientList(ROWS, CONTACTOS, 1000, { filtro: "todos", q: "" });
  assert.equal(r.total, 4);
  assert.deepEqual(r.conteos, { todos: 4, mora: 1, corriente: 2, sin_whatsapp: 1, sin_cuenta: 1 });
  assert.deepEqual(r.items.map((i) => i.clientId), ["a", "b", "c", "d"], "mayor vencido primero, luego mayor adeudo");
  assert.deepEqual(buildClientList(ROWS, CONTACTOS, 1000, { filtro: "sin_whatsapp", q: "" }).items.map((i) => i.clientId), ["b"]);
  assert.deepEqual(buildClientList(ROWS, CONTACTOS, 1000, { filtro: "sin_cuenta", q: "" }).items.map((i) => i.clientId), ["b"], "sin créditos activos no cuenta");
});

test("búsqueda por nombre sin acentos o por número de cliente", () => {
  assert.deepEqual(buildClientList(ROWS, CONTACTOS, 1000, { filtro: "todos", q: "logistica" }).items.map((i) => i.clientId), ["a"]);
  assert.deepEqual(buildClientList(ROWS, CONTACTOS, 1000, { filtro: "todos", q: "103" }).items.map((i) => i.clientId), ["c"]);
  const r = buildClientList(ROWS, CONTACTOS, 1000, { filtro: "mora", q: "norte" });
  assert.equal(r.items.length, 0, "Transportes Norte tiene residuos, no está en mora");
  assert.equal(r.conteos.todos, 1);
});

test("muestra a quién le llegan los recordatorios, respetando la elección del equipo", () => {
  const rows = ROWS.map((r) => (r.clientId === "c" ? { ...r, contactoCobranzaId: "c2" } : r));
  const c = buildClientList(rows, CONTACTOS, 1000, { filtro: "todos", q: "" }).items.find((i) => i.clientId === "c")!;
  assert.deepEqual(c.recordatorios, { telefono: "5533334444", nombre: "Contador", origen: "equipo" });
  const a = buildClientList(rows, CONTACTOS, 1000, { filtro: "todos", q: "" }).items.find((i) => i.clientId === "a")!;
  assert.equal(a.recordatorios.origen, "siac");
});
