import { test } from "node:test";
import assert from "node:assert/strict";
import { chooseRecipient, chooseRecipients, motivoNoRecibe, porDestinatario, tipoDe, validarContactoNuevo, type ContactLike } from "./contacts.ts";

const contacto = (over: Partial<ContactLike>): ContactLike => ({
  id: "x",
  relacion: "titular",
  rol: null,
  tipo: "telefono",
  telefonoWhatsapp: "525511112222",
  estatus: "activo",
  bajaWhatsappAt: null,
  esPrincipal: false,
  ...over,
});

test("tipos de contacto", () => {
  assert.equal(tipoDe({ relacion: "titular", rol: null }), "deudor");
  assert.equal(tipoDe({ relacion: "titular", rol: "pagos" }), "pagos");
  assert.equal(tipoDe({ relacion: "aval", rol: null }), "aval");
});

test("solo contactos del deudor, con WhatsApp válido y activos, reciben recordatorios", () => {
  assert.equal(motivoNoRecibe(contacto({})), null);
  assert.match(motivoNoRecibe(contacto({ relacion: "aval" }))!, /tercero/);
  assert.match(motivoNoRecibe(contacto({ tipo: "email", telefonoWhatsapp: null }))!, /correo/);
  assert.match(motivoNoRecibe(contacto({ telefonoWhatsapp: null }))!, /10 dígitos/);
  assert.match(motivoNoRecibe(contacto({ estatus: "invalido" }))!, /inválido/);
  assert.match(motivoNoRecibe(contacto({ bajaWhatsappAt: "2026-10-01" }))!, /no recibir/);
});

test("manda el elegido por el equipo sobre el sugerido por SIAC", () => {
  const cs = [contacto({ id: "siac", esPrincipal: true }), contacto({ id: "contador", rol: "contabilidad" })];
  assert.deepEqual(chooseRecipient(cs, "contador"), { contactId: "contador", origen: "equipo", aviso: null });
  assert.deepEqual(chooseRecipient(cs, null), { contactId: "siac", origen: "siac", aviso: null });
});

test("si el elegido dejó de servir, vuelve al sugerido y lo explica", () => {
  const cs = [contacto({ id: "siac", esPrincipal: true }), contacto({ id: "contador", estatus: "baja" })];
  const r = chooseRecipient(cs, "contador");
  assert.equal(r.contactId, "siac");
  assert.equal(r.origen, "siac");
  assert.match(r.aviso!, /pidió no recibir mensajes/);
  assert.match(chooseRecipient(cs, "borrado").aviso!, /ya no existe/);
});

test("sin ningún contacto válido no se manda a nadie", () => {
  const r = chooseRecipient([contacto({ id: "siac", esPrincipal: true, telefonoWhatsapp: null }), contacto({ id: "aval", relacion: "aval" })], null);
  assert.deepEqual(r, { contactId: null, origen: null, aviso: "Ningún contacto del deudor tiene un WhatsApp válido" });
});

test("validación de contactos agregados a mano", () => {
  assert.deepEqual(validarContactoNuevo("telefono", " +52 55 1234 5678 "), { ok: true, valor: "+52 55 1234 5678", telefonoWhatsapp: "525512345678" });
  assert.equal(validarContactoNuevo("telefono", "12345").ok, false);
  assert.deepEqual(validarContactoNuevo("email", "Pagos@Empresa.MX"), { ok: true, valor: "pagos@empresa.mx", telefonoWhatsapp: null });
  assert.equal(validarContactoNuevo("email", "no-es-correo").ok, false);
  assert.equal(validarContactoNuevo("telefono", "  ").ok, false);
});

test("varios destinatarios: todos los marcados que sirven, cada número una vez", () => {
  const cs = [
    contacto({ id: "siac", esPrincipal: true, telefonoWhatsapp: "525500000001", recibeRecordatorios: false }),
    contacto({ id: "dueno", rol: "dueno", telefonoWhatsapp: "525500000002", recibeRecordatorios: true }),
    contacto({ id: "pagos", rol: "pagos", telefonoWhatsapp: "525500000003", recibeRecordatorios: true }),
    contacto({ id: "repetido", telefonoWhatsapp: "525500000003", recibeRecordatorios: true }),
    contacto({ id: "baja", telefonoWhatsapp: "525500000004", estatus: "baja", recibeRecordatorios: true }),
    contacto({ id: "aval", relacion: "aval", telefonoWhatsapp: "525500000005", recibeRecordatorios: true }),
  ];
  const r = chooseRecipients(cs);
  assert.deepEqual(r.contactIds, ["dueno", "pagos"]);
  assert.equal(r.origen, "equipo");
  assert.match(r.aviso!, /2 contactos marcados no reciben/);
  // La marca manda sobre el elegido de antes (contacto_cobranza_id).
  assert.deepEqual(chooseRecipients(cs, "siac").contactIds, ["dueno", "pagos"]);
});

test("varios destinatarios: sin marcados que sirvan, el sugerido por SIAC; sin marca en la base, el elegido de antes", () => {
  const sinMarcas = [
    contacto({ id: "siac", esPrincipal: true, recibeRecordatorios: false }),
    contacto({ id: "otro", telefonoWhatsapp: null, recibeRecordatorios: true }),
  ];
  assert.deepEqual(chooseRecipients(sinMarcas), { contactIds: ["siac"], origen: "siac", aviso: "El contacto elegido ya no sirve (el teléfono no tiene 10 dígitos válidos); se usa el sugerido por SIAC" });
  assert.deepEqual(chooseRecipients([contacto({ id: "siac", esPrincipal: true, recibeRecordatorios: false })]).contactIds, ["siac"]);
  const viejos = [contacto({ id: "siac", esPrincipal: true }), contacto({ id: "contador", telefonoWhatsapp: "525500000009" })];
  assert.deepEqual(chooseRecipients(viejos, "contador"), { contactIds: ["contador"], origen: "equipo", aviso: null });
  assert.deepEqual(chooseRecipient(viejos, "contador").contactId, "contador");
});

test("una copia del candidato por destinatario", () => {
  const c = {
    nombre: "X",
    contactoCobranzaId: null,
    contactos: [
      contacto({ id: "siac", esPrincipal: true, telefonoWhatsapp: "525500000001", recibeRecordatorios: false }),
      contacto({ id: "a", telefonoWhatsapp: "525500000002", recibeRecordatorios: true }),
      contacto({ id: "b", telefonoWhatsapp: "525500000003", recibeRecordatorios: true }),
    ],
  };
  const copias = porDestinatario(c);
  assert.deepEqual(copias.map((x) => [x.contactId, x.candidato.contactos.map((k) => k.id)]), [["a", ["a"]], ["b", ["b"]]]);
  assert.deepEqual(chooseRecipients(copias[1].candidato.contactos, copias[1].candidato.contactoCobranzaId).contactIds, ["b"]);
  assert.deepEqual(porDestinatario({ ...c, contactos: [] }), [{ contactId: null, candidato: { ...c, contactos: [] } }]);
});
