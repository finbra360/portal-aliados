import { test } from "node:test";
import assert from "node:assert/strict";
import { correosValidos, decidirCorreoMora, decidirCorreoPreventivo, escapar } from "./correos.ts";
import type { PreventivoCandidate } from "./preventivos.ts";
import type { MoraCandidate } from "./whatsapp-mora.ts";

const CUENTA = { banco: "Banco Ficticio", beneficiario: "Finbra Demo", clabe: "032180000118359719" };

const prev = (over: Partial<PreventivoCandidate> = {}): PreventivoCandidate => ({
  creditId: "cr1",
  clientId: "c1",
  noCredito: "2001",
  nombre: "EMPRESA <FICTICIA> & CIA",
  proximoVencimiento: "2026-11-10",
  fechaUltimoPago: "2026-10-10",
  historial: { vecesMora: 0, atrasoMaximo: 0 },
  enMora: false,
  etapaManual: null,
  pausaHasta: null,
  contactos: [],
  contactoCobranzaId: null,
  correos: ["Pagos@Empresa-Ficticia.mx", "pagos@empresa-ficticia.mx", "sin-arroba"],
  yaSeIntento: false,
  monto: 18500,
  cuenta: CUENTA,
  ...over,
});

const mora = (over: Partial<MoraCandidate> = {}): MoraCandidate => ({
  clientId: "c1",
  nombre: "TRANSPORTES FICTICIOS",
  totalVencido: 41325.5,
  diasAtraso: 12,
  creditos: [{ noCredito: "2001", totalVencido: 30000 }, { noCredito: "2002 R", totalVencido: 11325.5 }],
  pausaHasta: null,
  etapa: null,
  promesaVigente: false,
  cuenta: CUENTA,
  contactos: [],
  contactoCobranzaId: null,
  correos: ["conta@transportes-ficticios.mx"],
  yaSeIntentoHoy: false,
  ultimaPlantilla: null,
  ...over,
});

test("correos válidos, sin repetir ni mayúsculas", () => {
  assert.deepEqual(correosValidos(["A@b.mx", "a@b.mx ", "malo", "otro@c.com"]), ["a@b.mx", "otro@c.com"]);
  assert.equal(escapar(`<b>"x" & 'y'</b>`), "&lt;b&gt;&quot;x&quot; &amp; &#39;y&#39;&lt;/b&gt;");
});

test("preventivo por correo: el día del pago, con datos de depósito y sin HTML del nombre", () => {
  const d = decidirCorreoPreventivo(prev(), { hoy: "2026-11-10", yaSeEnvio: false })!;
  assert.equal(d.enviar, true);
  if (!d.enviar) return;
  assert.deepEqual(d.destinatarios, ["pagos@empresa-ficticia.mx"]);
  assert.equal(d.asunto, "Tu pago vence hoy — Finbra");
  assert.match(d.html, /EMPRESA &lt;FICTICIA&gt; &amp; CIA/);
  assert.match(d.html, /\$18,500\.00 MXN/);
  assert.match(d.html, /10 de noviembre de 2026/);
  assert.match(d.html, /CLABE:<\/b> 032180000118359719/);
  assert.match(d.html, /Concepto:<\/b> 2001/);
});

test("preventivo por correo: mismas reglas que el WhatsApp, pero sin necesitar WhatsApp", () => {
  const motivo = (c: PreventivoCandidate, yaSeEnvio = false) => {
    const d = decidirCorreoPreventivo(c, { hoy: "2026-11-10", yaSeEnvio });
    return d && !d.enviar ? d.motivo : null;
  };
  assert.equal(motivo(prev()), null, "no tiene WhatsApp y aun así recibe correo");
  assert.match(motivo(prev({ correos: [] }))!, /Sin correo/);
  assert.match(motivo(prev({ enMora: true }))!, /mora/);
  assert.match(motivo(prev({ etapaManual: "juridico" }))!, /jurídico/);
  assert.match(motivo(prev({ cuenta: null }))!, /cuenta/);
  assert.match(motivo(prev({ monto: null }))!, /monto/);
  assert.match(motivo(prev(), true)!, /Ya se le envió/);
  assert.equal(decidirCorreoPreventivo(prev({ proximoVencimiento: "2026-11-20" }), { hoy: "2026-11-10", yaSeEnvio: false }), null);
  // 5 días antes solo a los rojos, como el WhatsApp.
  assert.match(motivo(prev({ proximoVencimiento: "2026-11-15" }))!, /rojos/);
});

test("viernes: el correo de un pago del lunes sale adelantado y con la fecha, no con 'mañana'", () => {
  const d = decidirCorreoPreventivo(prev({ proximoVencimiento: "2026-11-09", historial: { vecesMora: 1, atrasoMaximo: 3 } }), {
    hoy: "2026-11-06",
    cubiertos: ["2026-11-06", "2026-11-07", "2026-11-08"],
    yaSeEnvio: false,
  })!;
  assert.equal(d.etapa, "1d");
  assert.equal(d.adelantado, true);
  assert.equal(d.enviar && d.asunto, "Recordatorio de pago — Finbra");
  assert.ok(d.enviar && !/mañana/.test(d.html));
});

test("mora por correo: saldo, créditos y cuenta; mismas reglas que el WhatsApp", () => {
  const d = decidirCorreoMora(mora(), { umbral: 1000, hoy: "2026-11-06", yaSeEnvioHoy: false });
  assert.equal(d.enviar, true);
  if (!d.enviar) return;
  assert.equal(d.asunto, "Saldo vencido de tu crédito — Finbra");
  assert.match(d.html, /\$41,325\.50 MXN/);
  assert.match(d.html, /Créditos:<\/b> 2001 y 2002 R/);
  const motivo = (c: MoraCandidate, ya = false) => {
    const r = decidirCorreoMora(c, { umbral: 1000, hoy: "2026-11-06", yaSeEnvioHoy: ya });
    return r.enviar ? null : r.motivo;
  };
  assert.match(motivo(mora({ totalVencido: 500 }))!, /umbral/);
  assert.match(motivo(mora({ promesaVigente: true }))!, /promesa/);
  assert.match(motivo(mora({ correos: [] }))!, /Sin correo/);
  assert.match(motivo(mora(), true)!, /hoy/);
});
