import { test } from "node:test";
import assert from "node:assert/strict";
import { RANGO_ESTADO, esBaja, leerWebhook, ventana } from "./chat.ts";

const NUESTRO = "1269969176198359";

// Forma de los webhooks de la Cloud API de Meta (datos ficticios).
const webhook = (value: Record<string, unknown>, phoneNumberId = NUESTRO) => ({
  object: "whatsapp_business_account",
  entry: [{ id: "WABA", changes: [{ field: "messages", value: { messaging_product: "whatsapp", metadata: { display_phone_number: "525500000000", phone_number_id: phoneNumberId }, ...value } }] }],
});

test("webhook: mensaje de texto, con nombre de perfil y teléfono normalizado", () => {
  const r = leerWebhook(
    webhook({
      contacts: [{ wa_id: "5215511112222", profile: { name: "Juan Ficticio" } }],
      messages: [{ from: "5215511112222", id: "wamid.A", timestamp: "1792000000", type: "text", text: { body: "Ya pagué" }, context: { id: "wamid.REC" } }],
    }),
    NUESTRO,
  );
  assert.equal(r.estados.length, 0);
  assert.deepEqual(r.mensajes, [
    {
      wamid: "wamid.A",
      telefono: "525511112222",
      perfilNombre: "Juan Ficticio",
      recibidoAt: new Date(1792000000 * 1000),
      tipo: "texto",
      cuerpo: "Ya pagué",
      media: null,
      respondeA: "wamid.REC",
    },
  ]);
});

test("webhook: comprobante en foto o PDF, y otros tipos", () => {
  const r = leerWebhook(
    webhook({
      messages: [
        { from: "5215511112222", id: "wamid.I", timestamp: "1", type: "image", image: { id: "MEDIA1", mime_type: "image/jpeg", caption: "comprobante" } },
        { from: "5215511112222", id: "wamid.D", timestamp: "2", type: "document", document: { id: "MEDIA2", mime_type: "application/pdf", filename: "pago.pdf" } },
        { from: "5215511112222", id: "wamid.L", timestamp: "3", type: "location", location: {} },
        { from: "5215511112222", id: "wamid.B", timestamp: "4", type: "button", button: { text: "Ya pagué" } },
      ],
    }),
    NUESTRO,
  );
  assert.deepEqual(r.mensajes.map((m) => [m.tipo, m.cuerpo, m.media?.id ?? null, m.media?.nombre ?? null]), [
    ["otro", "comprobante", "MEDIA1", null],
    ["otro", "pago.pdf", "MEDIA2", "pago.pdf"],
    ["otro", "Ubicación", null, null],
    ["texto", "Ya pagué", null, null],
  ]);
});

test("webhook: estados de mensajes y errores", () => {
  const r = leerWebhook(
    webhook({
      statuses: [
        { id: "wamid.X", status: "delivered", timestamp: "10", recipient_id: "525511112222" },
        { id: "wamid.Y", status: "failed", timestamp: "11", errors: [{ code: 131026, title: "Message undeliverable", error_data: { details: "Message Undeliverable." } }] },
        { id: "wamid.Z", status: "deleted", timestamp: "12" },
      ],
    }),
    NUESTRO,
  );
  assert.deepEqual(r.estados, [
    { wamid: "wamid.X", estado: "entregado", at: new Date(10_000), error: null },
    { wamid: "wamid.Y", estado: "fallido", at: new Date(11_000), error: { code: 131026, mensaje: "Message Undeliverable." } },
  ]);
  assert.ok(RANGO_ESTADO.leido > RANGO_ESTADO.entregado, "un 'entregado' tardío no regresa un 'leído'");
});

test("webhook: lo de otro número o de otro campo se ignora", () => {
  const otro = leerWebhook(webhook({ messages: [{ from: "1", id: "w", timestamp: "1", type: "text", text: { body: "x" } }] }, "OTRO"), NUESTRO);
  assert.deepEqual(otro, { mensajes: [], estados: [] });
  assert.deepEqual(leerWebhook({ entry: [{ changes: [{ field: "account_update", value: {} }] }] }, NUESTRO), { mensajes: [], estados: [] });
  assert.deepEqual(leerWebhook(null, NUESTRO), { mensajes: [], estados: [] });
});

test("ventana de 24 horas para texto libre", () => {
  const ultima = new Date("2026-10-15T10:00:00Z");
  assert.equal(ventana(ultima, new Date("2026-10-16T09:59:00Z")).abierta, true);
  assert.equal(ventana(ultima, new Date("2026-10-16T10:00:00Z")).abierta, false);
  assert.deepEqual(ventana(null), { abierta: false, cierraAt: null });
});

test("el cliente pide la baja", () => {
  for (const t of ["BAJA", "baja.", " Stop ", "ALTO!", "Ya no me escriban"]) assert.equal(esBaja(t), true, t);
  for (const t of ["¿cómo me doy de baja del crédito?", "ya pagué", "", null]) assert.equal(esBaja(t), false, String(t));
});
