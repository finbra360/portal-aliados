import { test } from "node:test";
import assert from "node:assert/strict";
import { decidirPreventivo, etapaPara, fechaLarga, motivoSemaforo, semaforo, type PreventivoCandidate } from "./preventivos.ts";

const HOY = "2026-10-15";
const ACTIVAS = ["recordatorio_pago_5d", "recordatorio_pago_1d", "recordatorio_pago_dia"];

const cand = (over: Partial<PreventivoCandidate> = {}): PreventivoCandidate => ({
  creditId: "cr1",
  clientId: "c1",
  noCredito: "2001",
  nombre: "EMPRESA FICTICIA",
  proximoVencimiento: "2026-10-15",
  fechaUltimoPago: "2026-09-15",
  historial: { vecesMora: 0, atrasoMaximo: 0 },
  enMora: false,
  etapaManual: null,
  pausaHasta: null,
  contactos: [
    { id: "k1", relacion: "titular", rol: null, tipo: "telefono", telefonoWhatsapp: "525511112222", estatus: "activo", bajaWhatsappAt: null, esPrincipal: true, nombre: null },
  ],
  contactoCobranzaId: null,
  yaSeIntento: false,
  monto: 18500,
  ...over,
});
const decidir = (c: PreventivoCandidate) => decidirPreventivo(c, { hoy: HOY, plantillasActivas: ACTIVAS });

test("semáforo con el historial de SIAC", () => {
  assert.equal(semaforo({ vecesMora: 0, atrasoMaximo: 0 }), "verde");
  assert.equal(semaforo({ vecesMora: 1, atrasoMaximo: 12 }), "amarillo");
  assert.equal(semaforo({ vecesMora: 2, atrasoMaximo: 30 }), "amarillo", "30 días aún no es rojo");
  assert.equal(semaforo({ vecesMora: 2, atrasoMaximo: 31 }), "rojo");
  assert.equal(semaforo({ vecesMora: 3, atrasoMaximo: 5 }), "rojo");
  assert.equal(semaforo({ vecesMora: 1, atrasoMaximo: 5 }, { rojoVeces: 1, rojoAtraso: 30 }), "rojo", "umbrales configurables");
});

test("qué recordatorio toca según el vencimiento", () => {
  assert.equal(etapaPara(HOY, "2026-10-20"), "5d");
  assert.equal(etapaPara(HOY, "2026-10-16"), "1d");
  assert.equal(etapaPara(HOY, HOY), "dia");
  assert.equal(etapaPara(HOY, "2026-10-17"), null);
  assert.equal(etapaPara(HOY, "2026-10-14"), null, "ya venció: es mora, no preventivo");
  assert.equal(etapaPara(HOY, null), null);
});

test("mismas reglas de semáforo que n8n", () => {
  assert.match(motivoSemaforo("5d", "amarillo")!, /solo .* rojos/);
  assert.equal(motivoSemaforo("5d", "rojo"), null);
  assert.match(motivoSemaforo("1d", "verde")!, /verde/);
  assert.equal(motivoSemaforo("1d", "amarillo"), null);
  assert.equal(motivoSemaforo("dia", "verde"), null, "el día del pago, a todos");
});

test("preventivo: arma la plantilla del día con nombre, monto y fecha", () => {
  assert.deepEqual(decidir(cand()), {
    etapa: "dia",
    semaforo: "verde",
    aviso: null,
    enviar: true,
    contactId: "k1",
    telefono: "525511112222",
    plantilla: "recordatorio_pago_dia",
    parametros: ["EMPRESA FICTICIA", "18,500.00", "15 de octubre de 2026"],
  });
  assert.equal(fechaLarga("2026-01-05"), "5 de enero de 2026");
});

test("preventivo: a quién no se le escribe", () => {
  const motivo = (c: PreventivoCandidate) => {
    const d = decidir(c);
    return d && !d.enviar ? d.motivo : null;
  };
  assert.equal(decidir(cand({ proximoVencimiento: "2026-11-15" })), null, "no le toca hoy");
  assert.match(motivo(cand({ enMora: true }))!, /mora/);
  assert.match(motivo(cand({ etapaManual: "juridico" }))!, /jurídico/);
  assert.match(motivo(cand({ pausaHasta: HOY }))!, /pausada/);
  assert.match(motivo(cand({ proximoVencimiento: "2026-10-20" }))!, /rojos/, "verde a 5 días: no");
  assert.equal(decidir(cand({ proximoVencimiento: "2026-10-20", historial: { vecesMora: 5, atrasoMaximo: 40 } }))!.enviar, true, "rojo a 5 días: sí");
  assert.match(motivo(cand({ contactos: [] }))!, /WhatsApp/);
  assert.match(motivo(cand({ yaSeIntento: true }))!, /Ya se le envió/);
  assert.match(motivo(cand({ monto: null }))!, /pendiente de SIAC/);
  const sinPlantilla = decidirPreventivo(cand(), { hoy: HOY, plantillasActivas: [] });
  assert.match(sinPlantilla && !sinPlantilla.enviar ? sinPlantilla.motivo : "", /no está activa/);
});

test("preventivo: avisa si pagó hace poco (posible pago adelantado)", () => {
  assert.match(decidir(cand({ fechaUltimoPago: "2026-10-01" }))!.aviso!, /revisa si ya cubrió/);
  assert.equal(decidir(cand({ fechaUltimoPago: "2026-09-15" }))!.aviso, null);
});
