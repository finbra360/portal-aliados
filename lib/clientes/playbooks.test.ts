import { test } from "node:test";
import assert from "node:assert/strict";
import {
  AJUSTES_PLAYBOOKS_DEFAULT,
  leerAjustesPlaybooks,
  planPlaybooks,
  playbookDeOrigen,
  type CreditoPlaybook,
  type EmpresaPlaybook,
} from "./playbooks.ts";

const HOY = "2026-11-09";
const A = AJUSTES_PLAYBOOKS_DEFAULT;
const PRIMERA = "2026-09-28";

const credito = (over: Partial<CreditoPlaybook>): CreditoPlaybook => ({
  creditId: "c1",
  empresaId: "e1",
  noCredito: "D100",
  enListado: true,
  primeraFoto: PRIMERA,
  salioEl: null,
  cubiertos: 6,
  proximoVencimiento: "2026-12-01",
  fechaMinistracion: "2026-05-01",
  ...over,
});
const empresa = (over: Partial<EmpresaPlaybook>): EmpresaPlaybook => ({
  empresaId: "e1",
  enMora: false,
  especial: false,
  cuentaPago: true,
  whatsappValido: true,
  ultimoContacto: "2026-11-01T16:00:00.000Z",
  ultimaRevision: null,
  oportunidadAbierta: false,
  ...over,
});
const plan = (creditos: CreditoPlaybook[], empresas: EmpresaPlaybook[], ajustes = A) =>
  planPlaybooks({ creditos, empresas, ajustes, primeraFotoSistema: PRIMERA, hoy: HOY });
const llaves = (t: { dedupeKey: string }[]) => t.map((x) => x.dedupeKey);

test("ajustes: valores por omisión y limpieza", () => {
  assert.deepEqual(leerAjustesPlaybooks(undefined), A);
  assert.deepEqual(leerAjustesPlaybooks({ activo: false, primer_pago_dias: "x", revision_dias: 60, revision_max_por_dia: -1, liquidacion: false }), {
    ...A,
    activo: false,
    revisionDias: 60,
    liquidacion: false,
  });
});

test("crédito nuevo: bienvenida y, si faltan, cuenta de pago y contacto; los de la primera foto no cuentan", () => {
  const t = plan(
    [
      credito({ creditId: "nuevo", primeraFoto: "2026-11-06", fechaMinistracion: "2026-11-03", cubiertos: 0, proximoVencimiento: "2026-12-03" }),
      credito({ creditId: "viejo", empresaId: "e2", primeraFoto: PRIMERA }),
      credito({ creditId: "hace-mucho", empresaId: "e3", primeraFoto: "2026-10-20" }), // más de 7 días: ya pasó
    ],
    [empresa({ cuentaPago: false, whatsappValido: false }), empresa({ empresaId: "e2" }), empresa({ empresaId: "e3" })],
  );
  assert.deepEqual(llaves(t), ["playbook:bienvenida:nuevo", "playbook:bienvenida:nuevo:cuenta_pago", "playbook:bienvenida:nuevo:contacto_pagos"]);
  assert.equal(t[0].titulo, "Llamada de bienvenida: crédito D100");
  assert.equal(t[1].venceEl, "2026-11-11");
});

test("primer pago: sin mensualidades pagadas y vence en los próximos 5 días", () => {
  const t = plan(
    [
      credito({ creditId: "a", cubiertos: 0, proximoVencimiento: "2026-11-14" }), // 5 días
      credito({ creditId: "b", cubiertos: 0, proximoVencimiento: "2026-11-15" }), // 6 días
      credito({ creditId: "c", cubiertos: 1, proximoVencimiento: "2026-11-10" }), // ya pagó una
    ],
    [empresa({})],
  );
  assert.deepEqual(llaves(t), ["playbook:primer_pago:a"]);
  assert.equal(t[0].titulo, "Primer pago del crédito D100 el 14 nov 2026: confirmar CLABE y concepto");
});

test("salida del listado: una tarea por salida reciente", () => {
  const t = plan(
    [
      credito({ creditId: "s", enListado: false, salioEl: "2026-11-08" }),
      credito({ creditId: "vieja", enListado: false, salioEl: "2026-10-01" }),
    ],
    [empresa({})],
  );
  assert.deepEqual(llaves(t), ["playbook:liquidacion:s:2026-11-08"]);
});

test("revisión periódica: solo quien califica, el contacto más viejo primero y con tope diario", () => {
  const empresas = [
    empresa({ empresaId: "reciente", ultimoContacto: "2026-10-01T00:00:00Z" }), // contacto hace 39 días
    empresa({ empresaId: "viejo", ultimoContacto: "2026-07-01T00:00:00Z" }),
    empresa({ empresaId: "nunca", ultimoContacto: null }),
    empresa({ empresaId: "mora", ultimoContacto: null, enMora: true }),
    empresa({ empresaId: "opp", ultimoContacto: null, oportunidadAbierta: true }),
    empresa({ empresaId: "revisada", ultimoContacto: null, ultimaRevision: "2026-10-01" }),
    empresa({ empresaId: "joven", ultimoContacto: null }), // relación de menos de 90 días
  ];
  const creditos = empresas.map((e, i) =>
    credito({ creditId: `c${i}`, empresaId: e.empresaId, fechaMinistracion: e.empresaId === "joven" ? "2026-09-01" : "2026-01-15" }),
  );
  assert.deepEqual(llaves(plan(creditos, empresas)), ["playbook:revision:nunca:2026-11-09", "playbook:revision:viejo:2026-11-09"]);
  assert.deepEqual(llaves(plan(creditos, empresas, { ...A, revisionMaxPorDia: 1 })), ["playbook:revision:nunca:2026-11-09"]);
  assert.equal(plan(creditos, empresas)[1].titulo, "Revisión periódica: sin contacto desde el 1 jul 2026");
});

test("apagado: no crea nada", () => {
  assert.deepEqual(plan([credito({ cubiertos: 0, proximoVencimiento: "2026-11-10" })], [empresa({})], { ...A, activo: false }), []);
});

test("origen de la tarea", () => {
  assert.equal(playbookDeOrigen("playbook:bienvenida"), "Crédito nuevo");
  assert.equal(playbookDeOrigen("oportunidad:12"), "Renovación");
  assert.equal(playbookDeOrigen("manual"), null);
  assert.equal(playbookDeOrigen("playbook:otro"), null);
});

test("rescate: solo cuando la salud pasa a En riesgo desde otro nivel guardado", () => {
  const riesgo = { nivel: "riesgo" as const, puntos: 55, razones: ["12 días de atraso hoy"] };
  const t = plan(
    [],
    [
      empresa({ empresaId: "cayo", salud: riesgo, nivelAnterior: "atencion" }),
      empresa({ empresaId: "ya-estaba", salud: riesgo, nivelAnterior: "riesgo" }),
      empresa({ empresaId: "sin-historia", salud: riesgo, nivelAnterior: null }),
      empresa({ empresaId: "mejoro", salud: { nivel: "atencion", puntos: 70, razones: [] }, nivelAnterior: "riesgo" }),
    ],
  );
  const rescates = t.filter((x) => x.clave === "rescate");
  assert.deepEqual(llaves(rescates), [`playbook:rescate:cayo:${HOY}`]);
  assert.equal(rescates[0].titulo, "Llamada de rescate: su salud pasó a En riesgo (55/100)");
  assert.match(rescates[0].descripcion, /Antes estaba en Atención\. Qué le resta: 12 días de atraso hoy\./);
  assert.equal(rescates[0].tipo, "llamada");
  // Apagado en los ajustes: no crea nada.
  assert.equal(plan([], [empresa({ empresaId: "cayo", salud: riesgo, nivelAnterior: "sana" })], { ...A, rescate: false }).filter((x) => x.clave === "rescate").length, 0);
  assert.equal(playbookDeOrigen("playbook:rescate"), "Pasó a En riesgo");
});
