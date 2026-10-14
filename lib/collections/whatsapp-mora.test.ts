import { test } from "node:test";
import assert from "node:assert/strict";
import {
  bloqueosDeEnvio,
  contarVariables,
  EJEMPLO_MORA,
  PLANTILLAS_MORA,
  decidirMora,
  estadoDesdeMeta,
  limpiarParametro,
  motivoNoActivable,
  parametrosDePrueba,
  renderPlantilla,
  siguientePlantilla,
  textoCreditos,
  type MoraCandidate,
} from "./whatsapp-mora.ts";

const HOY = "2026-10-14";
const PLANTILLAS = ["finbra_mora_v1", "finbra_mora_v2", "finbra_mora_v3"];
const CLABE = "032180000118359719";

const tel = (over: Partial<MoraCandidate["contactos"][number]> = {}): MoraCandidate["contactos"][number] => ({
  id: "k1",
  relacion: "titular",
  rol: null,
  tipo: "telefono",
  telefonoWhatsapp: "525511112222",
  estatus: "activo",
  bajaWhatsappAt: null,
  esPrincipal: true,
  nombre: null,
  ...over,
});

const cliente = (over: Partial<MoraCandidate> = {}): MoraCandidate => ({
  clientId: "c1",
  nombre: "TRANSPORTES FICTICIOS",
  totalVencido: 41325,
  creditos: [{ noCredito: "2001", totalVencido: 41325 }],
  pausaHasta: null,
  etapa: null,
  promesaVigente: false,
  cuenta: { banco: "Banco Ficticio", beneficiario: "Finbra Demo", clabe: CLABE },
  contactos: [tel()],
  contactoCobranzaId: null,
  yaSeIntentoHoy: false,
  ultimaPlantilla: null,
  ...over,
});

const decidir = (c: MoraCandidate) => decidirMora(c, { umbral: 1000, hoy: HOY, plantillasActivas: PLANTILLAS });

test("mora: arma la plantilla con las 6 variables en orden", () => {
  assert.deepEqual(decidir(cliente()), {
    enviar: true,
    contactId: "k1",
    telefono: "525511112222",
    plantilla: "finbra_mora_v1",
    parametros: ["TRANSPORTES FICTICIOS", "41,325.00", "crédito 2001", "Banco Ficticio", "Finbra Demo", CLABE],
  });
  const conNombre = decidir(cliente({ contactos: [tel({ nombre: "Laura" })] }));
  assert.equal(conNombre.enviar && conNombre.parametros[0], "Laura", "usa el nombre del contacto si lo hay");
});

test("mora: a quién NO se le escribe", () => {
  const motivo = (c: MoraCandidate) => {
    const d = decidir(c);
    return d.enviar ? null : d.motivo;
  };
  assert.match(motivo(cliente({ totalVencido: 600 }))!, /umbral/);
  assert.match(motivo(cliente({ etapa: "juridico" }))!, /jurídico/);
  assert.match(motivo(cliente({ etapa: "reestructura" }))!, /reestructura/);
  assert.match(motivo(cliente({ pausaHasta: HOY }))!, /pausada/, "pausado hasta hoy, incluido");
  assert.equal(decidir(cliente({ pausaHasta: "2026-10-13" })).enviar, true, "la pausa ya terminó");
  assert.match(motivo(cliente({ promesaVigente: true }))!, /promesa/);
  assert.match(motivo(cliente({ cuenta: null }))!, /cuenta de pago/);
  assert.match(motivo(cliente({ contactos: [tel({ telefonoWhatsapp: null })] }))!, /WhatsApp/);
  assert.match(motivo(cliente({ contactos: [tel({ relacion: "aval" })] }))!, /WhatsApp/, "nunca al aval");
  assert.match(motivo(cliente({ contactos: [tel({ bajaWhatsappAt: "2026-10-01" })] }))!, /WhatsApp/, "pidió no recibir mensajes");
  assert.match(motivo(cliente({ yaSeIntentoHoy: true }))!, /hoy/);
  assert.match((decidirMora(cliente(), { umbral: 1000, hoy: HOY, plantillasActivas: [] }) as { motivo: string }).motivo, /plantillas/);
});

test("mora: rota las plantillas", () => {
  assert.equal(siguientePlantilla(PLANTILLAS, null), "finbra_mora_v1");
  assert.equal(siguientePlantilla(PLANTILLAS, "finbra_mora_v1"), "finbra_mora_v2");
  assert.equal(siguientePlantilla(PLANTILLAS, "finbra_mora_v3"), "finbra_mora_v1");
  assert.equal(siguientePlantilla(["finbra_mora_v1", "finbra_mora_v3"], "finbra_mora_v2"), "finbra_mora_v1", "la última ya no está activa");
  assert.equal(siguientePlantilla([], null), null);
});

test("mora: créditos y parámetros que Meta acepta", () => {
  assert.equal(textoCreditos([{ noCredito: "2001", totalVencido: 5 }, { noCredito: "2002 R", totalVencido: 7 }, { noCredito: "2003", totalVencido: 0 }]), "créditos 2001 y 2002 R");
  assert.equal(textoCreditos([{ noCredito: "1", totalVencido: 1 }, { noCredito: "2", totalVencido: 1 }, { noCredito: "3", totalVencido: 1 }]), "créditos 1, 2 y 3");
  assert.equal(limpiarParametro(" EMPRESA\nFICTICIA   S.A.\t"), "EMPRESA FICTICIA S.A.");
});

test("plantillas: variables, texto final y estado de Meta", () => {
  const cuerpo = "Hola {{1}}, debes ${{2}} ({{3}}). Transfiere a {{4}}, a nombre de {{5}}, CLABE {{6}}. Gracias {{1}}.";
  assert.equal(contarVariables(cuerpo), 6, "{{1}} repetida cuenta una vez");
  assert.equal(
    renderPlantilla(cuerpo, ["Ana", "1,000.00", "crédito 1", "BBVA", "Finbra", CLABE]),
    `Hola Ana, debes $1,000.00 (crédito 1). Transfiere a BBVA, a nombre de Finbra, CLABE ${CLABE}. Gracias Ana.`,
  );
  assert.equal(renderPlantilla("Hola {{1}} {{7}}", ["Ana"]), "Hola Ana {{7}}", "una variable sin valor se queda visible");
  assert.equal(estadoDesdeMeta("APPROVED"), "aprobada");
  assert.equal(estadoDesdeMeta("REJECTED"), "rechazada");
  assert.equal(estadoDesdeMeta("PAUSED"), "pausada");
  assert.equal(estadoDesdeMeta("PENDING"), "pendiente");
  assert.equal(estadoDesdeMeta(undefined), "pendiente");
  assert.equal(motivoNoActivable({ estadoMeta: "aprobada", cuerpo }), null);
  assert.match(motivoNoActivable({ estadoMeta: "pendiente", cuerpo })!, /no la aprueba/);
  assert.match(motivoNoActivable({ estadoMeta: "rechazada", cuerpo })!, /rechazó/);
  assert.match(motivoNoActivable({ estadoMeta: "pausada", cuerpo })!, /pausó/);
  assert.match(motivoNoActivable({ estadoMeta: "aprobada", cuerpo: "Hola {{1}}, debes {{2}}" })!, /2 variables/);
  assert.deepEqual(parametrosDePrueba({ banco: "BBVA", beneficiario: "Finbra", clabe: CLABE }), ["Prueba Finbra", "1,234.56", "crédito 0000", "BBVA", "Finbra", CLABE]);
});

test("plantillas que se dan de alta en Meta: 6 variables en orden, sin empezar ni terminar en variable", () => {
  assert.deepEqual(PLANTILLAS_MORA.map((p) => p.nombre), ["finbra_mora_v1", "finbra_mora_v2", "finbra_mora_v3"]);
  for (const p of PLANTILLAS_MORA) {
    assert.equal(contarVariables(p.cuerpo), 6, p.nombre);
    const orden = [...p.cuerpo.matchAll(/\{\{(\d+)\}\}/g)].map((m) => Number(m[1]));
    assert.deepEqual(orden, [1, 2, 3, 4, 5, 6], `${p.nombre}: aparecen en orden`);
    assert.doesNotMatch(p.cuerpo, /^\{\{|\}\}$/, `${p.nombre}: Meta rechaza plantillas que empiezan o terminan en variable`);
    assert.ok(p.cuerpo.length <= 1024, `${p.nombre}: máximo 1024 caracteres`);
  }
  assert.equal(EJEMPLO_MORA.length, 6);
});

test("mora: bloqueos antes de enviar", () => {
  const listo = { ambiente: "produccion", activado: true, configurado: true, plantillasActivas: 3, fotoDeHoy: true, hora: "09:30", ventana: { desde: "09:00", hasta: "19:00" } };
  assert.deepEqual(bloqueosDeEnvio(listo), []);
  assert.match(bloqueosDeEnvio({ ...listo, ambiente: "pruebas" })[0], /pruebas/);
  assert.equal(bloqueosDeEnvio({ ...listo, hora: "08:59" }).length, 1);
  assert.equal(bloqueosDeEnvio({ ...listo, hora: "19:00" }).length, 1);
  assert.equal(bloqueosDeEnvio({ ...listo, activado: false, configurado: false, plantillasActivas: 0, fotoDeHoy: false }).length, 4);
});
