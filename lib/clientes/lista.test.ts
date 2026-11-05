import { test } from "node:test";
import assert from "node:assert/strict";
import { buildEmpresasLista, resumirEmpresa, type CreditoEmpresaRow, type EmpresaRow } from "./lista.ts";
import { normalizarRfc, validarRfc } from "./rfc.ts";

const HOY = "2026-11-05";

const empresa = (over: Partial<EmpresaRow>): EmpresaRow => ({
  empresaId: "e",
  nombre: "EMPRESA FICTICIA",
  razonSocial: "EMPRESA FICTICIA SA DE CV",
  rfc: null,
  industria: null,
  ejecutivoEmail: null,
  ejecutivoNombre: null,
  numerosCliente: ["000000100"],
  negociosGanados: 0,
  primerCierre: null,
  ...over,
});

const credito = (over: Partial<CreditoEmpresaRow>): CreditoEmpresaRow => ({
  empresaId: "e",
  creditId: "c",
  noCredito: "1000",
  enListado: true,
  etapaManual: null,
  montoCredito: 1_000_000,
  fechaTermino: "2028-01-15",
  adeudo: 500_000,
  vencido: 0,
  atraso: 0,
  proximoVencimiento: "2026-11-20",
  montoSiguiente: 40_000,
  vecesMora: 0,
  atrasoMaximo: 0,
  ...over,
});

test("totales de la empresa con sus créditos vigentes; los que salieron de SIAC no suman", () => {
  const r = resumirEmpresa(
    empresa({}),
    [
      credito({ creditId: "a", adeudo: 300_000, vencido: 20_000, atraso: 12, montoCredito: 800_000 }),
      credito({ creditId: "b", adeudo: 200_000, vencido: 0, montoCredito: 400_000 }),
      credito({ creditId: "c", enListado: false, adeudo: null, vencido: null, atraso: null, montoCredito: 999_999 }),
    ],
    1000,
    HOY,
  );
  assert.equal(r.creditosVigentes, 2);
  assert.equal(r.adeudo, 500_000);
  assert.equal(r.vencido, 20_000);
  assert.equal(r.montoOriginal, 1_200_000);
  assert.equal(r.maxAtraso, 12);
  assert.equal(r.enMora, true);
});

test("próximo pago: la fecha más cercana, sumando los créditos que vencen ese día", () => {
  const r = resumirEmpresa(
    empresa({}),
    [
      credito({ creditId: "a", proximoVencimiento: "2026-11-20", montoSiguiente: 40_000 }),
      credito({ creditId: "b", proximoVencimiento: "2026-11-10", montoSiguiente: 15_000 }),
      credito({ creditId: "c", proximoVencimiento: "2026-11-10", montoSiguiente: 5_000 }),
    ],
    1000,
    HOY,
  );
  assert.deepEqual(r.proximoPago, { fecha: "2026-11-10", monto: 20_000 });
  const sinMonto = resumirEmpresa(empresa({}), [credito({ montoSiguiente: null })], 1000, HOY);
  assert.deepEqual(sinMonto.proximoPago, { fecha: "2026-11-20", monto: null }, "si SIAC no da el monto, no se inventa");
});

test("etapa del ciclo derivada de los créditos", () => {
  const etapa = (cs: CreditoEmpresaRow[]) => resumirEmpresa(empresa({}), cs, 1000, HOY).etapa;
  assert.equal(etapa([]), "sin_creditos");
  assert.equal(resumirEmpresa(empresa({ negociosGanados: 2 }), [], 1000, HOY).etapa, "ex_cliente", "sin SIAC pero con negocios ganados en HubSpot");
  assert.equal(resumirEmpresa(empresa({ negociosGanados: 2 }), [credito({})], 1000, HOY).etapa, "activo", "si tiene créditos vigentes, manda SIAC");
  assert.equal(etapa([credito({ enListado: false })]), "ex_cliente");
  assert.equal(etapa([credito({})]), "activo");
  assert.equal(etapa([credito({ fechaTermino: "2027-02-03" })]), "por_liquidar", "90 días exactos");
  assert.equal(etapa([credito({ fechaTermino: "2027-02-04" })]), "activo", "91 días");
  assert.equal(etapa([credito({ fechaTermino: "2026-11-04" })]), "activo", "un plazo que ya terminó no es «por liquidar»");
  assert.equal(etapa([credito({ fechaTermino: "2026-12-01", etapaManual: "extrajudicial" })]), "cobranza_especial", "la etapa manual manda");
  assert.equal(etapa([credito({ fechaTermino: "2026-12-01" }), credito({ creditId: "j", etapaManual: "juridico" })]), "cobranza_especial");
});

test("fin de plazo: el más cercano que todavía no termina", () => {
  const r = resumirEmpresa(empresa({}), [credito({ fechaTermino: "2026-11-01" }), credito({ creditId: "b", fechaTermino: "2026-12-05" }), credito({ creditId: "x", fechaTermino: "2027-06-01" })], 1000, HOY);
  assert.deepEqual(r.finPlazo, { fecha: "2026-12-05", dias: 30 });
});

test("semáforo con lo peor de sus créditos en la foto; sin foto no hay semáforo", () => {
  const r = resumirEmpresa(empresa({}), [credito({ vecesMora: 1, atrasoMaximo: 5 }), credito({ creditId: "b", vecesMora: 0, atrasoMaximo: 40 })], 1000, HOY);
  assert.deepEqual(r.historial, { vecesMora: 1, atrasoMaximo: 40 });
  assert.equal(r.semaforo, "rojo");
  assert.equal(resumirEmpresa(empresa({}), [credito({ adeudo: null, vecesMora: null })], 1000, HOY).semaforo, null);
});

const EMPRESAS = [
  empresa({ empresaId: "a", nombre: "Ágora Logística", rfc: "ALO150101AB1", ejecutivoEmail: "yo@finbra.test", numerosCliente: ["000000101"] }),
  empresa({ empresaId: "b", nombre: "Transportes Norte", numerosCliente: ["000000102"] }),
  empresa({ empresaId: "c", nombre: "Clínica Centro", ejecutivoEmail: "otro@finbra.test", numerosCliente: ["000000103"] }),
  empresa({ empresaId: "d", nombre: "Ya Liquidó", numerosCliente: ["000000104"] }),
];
const CREDITOS = [
  credito({ empresaId: "a", creditId: "a1", noCredito: "1008 R", adeudo: 900_000, vencido: 0 }),
  credito({ empresaId: "b", creditId: "b1", noCredito: "1010", adeudo: 400_000, vencido: 80_000, atraso: 95, etapaManual: "juridico" }),
  credito({ empresaId: "c", creditId: "c1", noCredito: "1009", adeudo: 100_000, vencido: 300, atraso: 2, fechaTermino: "2026-12-01" }),
  credito({ empresaId: "d", creditId: "d1", noCredito: "0900", enListado: false, adeudo: null, vencido: null, atraso: null }),
];
const lista = (opts: Partial<Parameters<typeof buildEmpresasLista>[4]>) =>
  buildEmpresasLista(EMPRESAS, CREDITOS, 1000, HOY, { filtro: "todos", q: "", yo: "yo@finbra.test", ...opts });
const ids = (opts: Partial<Parameters<typeof buildEmpresasLista>[4]>) => lista(opts).items.map((i) => i.empresaId);

test("filtros y conteos de la lista", () => {
  const r = lista({});
  assert.equal(r.total, 4);
  assert.deepEqual(r.conteos, { todos: 4, mios: 1, activos: 3, por_liquidar: 1, mora: 1, especial: 1, ex_clientes: 1, sin_ejecutivo: 2, sin_rfc: 3 });
  assert.deepEqual(ids({ filtro: "mora" }), ["b"], "los $300 de la clínica son residuo, no mora");
  assert.deepEqual(ids({ filtro: "por_liquidar" }), ["c"]);
  assert.deepEqual(ids({ filtro: "mios" }), ["a"]);
  assert.deepEqual(ids({ filtro: "ex_clientes" }), ["d"]);
});

test("los totales cuadran con la suma de los créditos vigentes en la foto", () => {
  const r = lista({});
  const vigentes = CREDITOS.filter((c) => c.enListado);
  assert.equal(r.totales.adeudo, vigentes.reduce((s, c) => s + (c.adeudo ?? 0), 0));
  assert.equal(r.totales.vencido, vigentes.reduce((s, c) => s + (c.vencido ?? 0), 0));
});

test("búsqueda por nombre sin acentos, RFC, número de cliente o de crédito", () => {
  assert.deepEqual(ids({ q: "agora" }), ["a"]);
  assert.deepEqual(ids({ q: "alo150101" }), ["a"]);
  assert.deepEqual(ids({ q: "000000103" }), ["c"]);
  assert.deepEqual(ids({ q: "1008 r" }), ["a"]);
});

test("orden por nombre, montos, próximo pago y fin de plazo", () => {
  assert.deepEqual(ids({}), ["a", "c", "b", "d"], "de la A a la Z sin importar acentos");
  assert.deepEqual(ids({ orden: "adeudo" }), ["a", "b", "c", "d"]);
  assert.deepEqual(ids({ orden: "vencido" }), ["b", "c", "a", "d"]);
  assert.deepEqual(ids({ orden: "termino" }), ["c", "a", "b", "d"], "sin fecha al final");
});

test("RFC: normaliza y valida forma y fecha", () => {
  assert.equal(normalizarRfc(" tef-150101 ab1 "), "TEF150101AB1");
  assert.deepEqual(validarRfc(""), { ok: true, rfc: null });
  assert.deepEqual(validarRfc("tef150101ab1"), { ok: true, rfc: "TEF150101AB1" }, "persona moral");
  assert.deepEqual(validarRfc("PEGJ800101AB1"), { ok: true, rfc: "PEGJ800101AB1" }, "persona física");
  assert.deepEqual(validarRfc("ÑAÑ150101AB1"), { ok: true, rfc: "ÑAÑ150101AB1" });
  assert.equal(validarRfc("ABC123").ok, false);
  assert.equal(validarRfc("TEF151301AB1").ok, false, "mes 13");
  assert.equal(validarRfc("TEF150100AB1").ok, false, "día 00");
});
