import { test } from "node:test";
import assert from "node:assert/strict";
import {
  AJUSTES_RENOVACION_DEFAULT,
  evaluarRenovacion,
  leerAjustesRenovacion,
  planRadar,
  tareaDeVentana,
  validarCambioOportunidad,
  ventanaDe,
  type CreditoRenovacion,
  type OportunidadRadar,
} from "./renovaciones.ts";

const HOY = "2026-11-05";
const A = AJUSTES_RENOVACION_DEFAULT;

const credito = (over: Partial<CreditoRenovacion>): CreditoRenovacion => ({
  creditId: "c1",
  empresaId: "e1",
  noCredito: "D100",
  enListado: true,
  fechaTermino: "2027-01-20", // 76 días
  montoCredito: 1_000_000,
  atraso: 0,
  vencido: 0,
  atrasoMaximo: 0,
  vecesMora: 0,
  etapaManual: null,
  cubiertos: 22,
  vencimientos: 24,
  ...over,
});

test("ajustes: valores por omisión y limpieza de lo que no sirve", () => {
  assert.deepEqual(leerAjustesRenovacion(null), A);
  assert.deepEqual(leerAjustesRenovacion({ activo: false, ventanas: [30, "60", 90, 90, -1], atraso_maximo_historico: 10, veces_mora_max: "x" }), {
    activo: false,
    ventanas: [90, 60, 30],
    atrasoMaximoHistorico: 10,
    vecesMoraMax: 2,
  });
});

test("ventana: la más chica que todavía cubre los días que faltan", () => {
  assert.equal(ventanaDe(91, A.ventanas), null);
  assert.equal(ventanaDe(90, A.ventanas), 90);
  assert.equal(ventanaDe(61, A.ventanas), 90);
  assert.equal(ventanaDe(45, A.ventanas), 60);
  assert.equal(ventanaDe(0, A.ventanas), 30);
  assert.equal(ventanaDe(-1, A.ventanas), null);
});

test("califica: al corriente y con buen historial, con sus razones", () => {
  const c = credito({});
  const ev = evaluarRenovacion(c, [c], A, HOY);
  assert.ok(ev.califica);
  assert.deepEqual(ev.razones, [
    "Al corriente en todos sus créditos",
    "Nunca ha caído en mora",
    "22 de 24 mensualidades pagadas",
    "El crédito D100 termina el 20 ene 2027 (en 76 días)",
  ]);
});

test("no califica: atraso hoy en otro crédito, historial, etapa especial; dice todos los motivos", () => {
  const c = credito({ atrasoMaximo: 20, vecesMora: 3 });
  const otro = credito({ creditId: "c2", noCredito: "D101", atraso: 5, etapaManual: "juridico" });
  const ev = evaluarRenovacion(c, [c, otro], A, HOY);
  assert.equal(ev.califica, false);
  assert.ok(!ev.califica);
  assert.deepEqual(ev.motivos, ["Tiene 5 días de atraso", "Su peor atraso fue de 20 días (máximo 15)", "Cayó en mora 3 veces (máximo 2)", "Está en jurídico"]);
  // Un crédito que ya salió del listado no cuenta.
  assert.ok(evaluarRenovacion(c, [credito({}), credito({ creditId: "x", enListado: false, atraso: 90 })], A, HOY).califica);
});

const plan = (creditos: CreditoRenovacion[], oportunidades: OportunidadRadar[] = [], ajustes = A) =>
  planRadar({ creditos, oportunidades, ajustes, umbralMora: 1000, hoy: HOY });

test("radar: abre una por empresa (el crédito que termina primero) y solo si califica", () => {
  const acciones = plan([
    credito({ creditId: "c1", fechaTermino: "2027-01-20" }),
    credito({ creditId: "c2", noCredito: "D102", fechaTermino: "2026-12-10" }), // 35 días: termina primero
    credito({ creditId: "c3", empresaId: "e2", fechaTermino: "2027-03-01" }), // 116 días: fuera de ventana
    credito({ creditId: "c4", empresaId: "e3", vecesMora: 5 }), // no califica
    credito({ creditId: "c5", empresaId: "e4", fechaTermino: "2026-11-01" }), // ya terminó
  ]);
  assert.deepEqual(
    acciones.map((a) => [a.tipo, a.tipo === "abrir" ? a.credito.creditId : "", a.tipo === "abrir" ? a.ventana : 0]),
    [["abrir", "c2", 60]],
  );
});

test("radar: recuerda las abiertas, cierra las que salieron del listado o cayeron en mora, y no reabre un crédito", () => {
  const creditos = [
    credito({ creditId: "c1", empresaId: "e1", fechaTermino: "2026-11-25" }), // 20 días
    credito({ creditId: "c2", empresaId: "e2", enListado: false }),
    credito({ creditId: "c3", empresaId: "e3", atraso: 12, vencido: 30_000 }),
    credito({ creditId: "c4", empresaId: "e4" }),
  ];
  const oportunidades: OportunidadRadar[] = [
    { id: "1", empresaId: "e1", creditId: "c1", estado: "en_contacto" },
    { id: "2", empresaId: "e2", creditId: "c2", estado: "abierta" },
    { id: "3", empresaId: "e3", creditId: "c3", estado: "interesado" },
    { id: "4", empresaId: "e4", creditId: "c4", estado: "descartada" }, // ya tuvo: no se reabre
  ];
  const acciones = plan(creditos, oportunidades);
  assert.deepEqual(
    acciones.map((a) => (a.tipo === "cerrar" ? [a.tipo, a.oportunidadId, a.motivo] : a.tipo === "recordar" ? [a.tipo, a.oportunidadId, a.ventana] : [a.tipo])),
    [
      ["recordar", "1", 30],
      ["cerrar", "2", "El crédito salió del listado de SIAC"],
      ["cerrar", "3", "La empresa cayó en mora"],
    ],
  );
});

test("radar apagado: solo cierra lo que ya no aplica, no abre ni recuerda", () => {
  const acciones = plan(
    [credito({ creditId: "c1" }), credito({ creditId: "c2", empresaId: "e2", enListado: false })],
    [{ id: "9", empresaId: "e2", creditId: "c2", estado: "abierta" }],
    { ...A, activo: false },
  );
  assert.deepEqual(acciones.map((a) => a.tipo), ["cerrar"]);
});

test("tarea de cada ventana: la primera es ofrecer la renovación", () => {
  const c = credito({ fechaTermino: "2026-11-25" });
  assert.equal(tareaDeVentana(30, A.ventanas, c, true).titulo, "Ofrecer renovación: el crédito D100 termina el 25 nov 2026");
  assert.equal(tareaDeVentana(30, A.ventanas, c, false).titulo, "Renovación: faltan 30 días o menos para que termine el crédito D100 (25 nov 2026)");
  assert.equal(tareaDeVentana(90, A.ventanas, c, false).tipo, "llamada");
});

test("cambios de estado: descartar pide motivo; cerrada no se mueve", () => {
  assert.equal(validarCambioOportunidad("abierta", "descartada", " ").ok, false);
  assert.equal(validarCambioOportunidad("abierta", "cerrada", "").ok, false);
  assert.equal(validarCambioOportunidad("ganada", "interesado", "").ok, false);
  assert.equal(validarCambioOportunidad("interesado", "interesado", "").ok, false);
  assert.deepEqual(validarCambioOportunidad("abierta", "descartada", " Ya no necesita crédito "), { ok: true, estado: "descartada", motivo: "Ya no necesita crédito" });
});
