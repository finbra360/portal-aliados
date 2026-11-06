// Lista de clientes de Clientes 360: una fila por empresa con los totales de
// sus créditos en la última foto de SIAC. Función pura, sin base de datos,
// para poder probarla con `node --test`.
//
// Las cifras salen de las mismas columnas que la lista de Cobranza (TotalAdeudo,
// TotalVencido, Antiguedad de la foto del día), así que suman lo mismo.

import { estaEnMora } from "../collections/rules.ts";
import { UMBRALES_SEMAFORO_DEFAULT, semaforo, type Semaforo, type UmbralesSemaforo } from "../collections/preventivos.ts";

/** Días antes del fin del plazo en que un cliente pasa a «Por liquidar». */
export const VENTANA_POR_LIQUIDAR = 90;

/** Etapas manuales de cobranza que sacan al cliente del flujo normal. */
const ETAPAS_ESPECIALES = new Set(["juridico", "extrajudicial", "reestructura"]);

export interface EmpresaRow {
  empresaId: string;
  nombre: string;
  razonSocial: string | null;
  rfc: string | null;
  industria: string | null;
  ejecutivoEmail: string | null;
  ejecutivoNombre: string | null;
  /** Números de cliente de SIAC ligados a la empresa. */
  numerosCliente: string[];
}

export interface CreditoEmpresaRow {
  empresaId: string;
  creditId: string;
  noCredito: string;
  /** false = salió del listado de SIAC. */
  enListado: boolean;
  etapaManual: string | null;
  montoCredito: number | null;
  fechaTermino: string | null;
  /** De la última foto completa; null si el crédito no viene en ella. */
  adeudo: number | null;
  vencido: number | null;
  atraso: number | null;
  proximoVencimiento: string | null;
  montoSiguiente: number | null;
  vecesMora: number | null;
  atrasoMaximo: number | null;
}

/**
 * Dónde está la relación, derivado de sus créditos (nadie lo captura):
 * - cobranza_especial: algún crédito vigente en jurídico, extrajudicial o reestructura;
 * - por_liquidar: algún crédito vigente termina en los próximos 90 días;
 * - activo: tiene créditos vigentes;
 * - ex_cliente: tuvo créditos y ya ninguno está en el listado;
 * - sin_creditos: todavía no tiene créditos en SIAC.
 */
export type EtapaCiclo = "cobranza_especial" | "por_liquidar" | "activo" | "ex_cliente" | "sin_creditos";

export const ETAPAS_CICLO: Record<EtapaCiclo, string> = {
  activo: "Activo",
  por_liquidar: "Por liquidar",
  cobranza_especial: "Cobranza especial",
  ex_cliente: "Ex cliente",
  sin_creditos: "Sin créditos",
};

export interface EmpresaListItem extends EmpresaRow {
  creditosVigentes: number;
  /** Suma de MontoCredito de los créditos vigentes. */
  montoOriginal: number;
  adeudo: number;
  vencido: number;
  maxAtraso: number;
  enMora: boolean;
  /** Lo peor de sus créditos vigentes en la foto; null si no tiene ninguno en ella. */
  historial: { vecesMora: number; atrasoMaximo: number } | null;
  semaforo: Semaforo | null;
  proximoPago: { fecha: string; monto: number | null } | null;
  /** Fin de plazo más cercano de sus créditos vigentes que todavía no termina. */
  finPlazo: { fecha: string; dias: number } | null;
  etapa: EtapaCiclo;
}

export type EmpresaFilter = "todos" | "activos" | "por_liquidar" | "mora" | "especial" | "ex_clientes" | "mios" | "sin_ejecutivo" | "sin_rfc";
export type EmpresaOrder = "nombre" | "adeudo" | "vencido" | "proximo" | "termino";

export const FILTROS_EMPRESA: { value: EmpresaFilter; label: string }[] = [
  { value: "todos", label: "Todos" },
  { value: "mios", label: "Mis clientes" },
  { value: "activos", label: "Con crédito vigente" },
  { value: "por_liquidar", label: "Por liquidar (90 días)" },
  { value: "mora", label: "En mora" },
  { value: "especial", label: "Cobranza especial" },
  { value: "ex_clientes", label: "Ex clientes" },
  { value: "sin_ejecutivo", label: "Sin ejecutivo" },
  { value: "sin_rfc", label: "Sin RFC" },
];

export const ORDENES_EMPRESA: { value: EmpresaOrder; label: string }[] = [
  { value: "nombre", label: "Nombre (A–Z)" },
  { value: "adeudo", label: "Mayor adeudo" },
  { value: "vencido", label: "Mayor vencido" },
  { value: "proximo", label: "Próximo pago" },
  { value: "termino", label: "Fin de plazo" },
];

const sinAcentos = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const dias = (desde: string, hasta: string) => Math.round((Date.parse(hasta) - Date.parse(desde)) / 86_400_000);
const r2 = (n: number) => Math.round(n * 100) / 100;

const porNombre = (a: EmpresaListItem, b: EmpresaListItem) => a.nombre.localeCompare(b.nombre, "es", { sensitivity: "base" });
const COMPARAR: Record<EmpresaOrder, (a: EmpresaListItem, b: EmpresaListItem) => number> = {
  nombre: porNombre,
  adeudo: (a, b) => b.adeudo - a.adeudo || porNombre(a, b),
  vencido: (a, b) => b.vencido - a.vencido || b.adeudo - a.adeudo || porNombre(a, b),
  proximo: (a, b) => (a.proximoPago?.fecha ?? "9999").localeCompare(b.proximoPago?.fecha ?? "9999") || porNombre(a, b),
  termino: (a, b) => (a.finPlazo?.fecha ?? "9999").localeCompare(b.finPlazo?.fecha ?? "9999") || porNombre(a, b),
};

/** Totales y etapa de una empresa a partir de sus créditos. */
export function resumirEmpresa(
  e: EmpresaRow,
  creditos: CreditoEmpresaRow[],
  umbral: number,
  hoy: string,
  umbralesSemaforo: UmbralesSemaforo = UMBRALES_SEMAFORO_DEFAULT,
): EmpresaListItem {
  const vigentes = creditos.filter((c) => c.enListado);
  const enFoto = vigentes.filter((c) => c.adeudo !== null);
  const suma = (f: (c: CreditoEmpresaRow) => number | null) => r2(vigentes.reduce((s, c) => s + (f(c) ?? 0), 0));
  const maxAtraso = vigentes.reduce((m, c) => Math.max(m, c.atraso ?? 0), 0);
  const vencido = suma((c) => c.vencido);
  const historial = enFoto.length
    ? {
        vecesMora: enFoto.reduce((m, c) => Math.max(m, c.vecesMora ?? 0), 0),
        atrasoMaximo: enFoto.reduce((m, c) => Math.max(m, c.atrasoMaximo ?? 0), 0),
      }
    : null;

  const proximo = vigentes
    .filter((c) => c.proximoVencimiento)
    .sort((a, b) => a.proximoVencimiento!.localeCompare(b.proximoVencimiento!))[0];
  // Si dos créditos vencen el mismo día, el pago de ese día es la suma de los dos.
  const proximoPago = proximo
    ? {
        fecha: proximo.proximoVencimiento!,
        monto: (() => {
          const mismos = vigentes.filter((c) => c.proximoVencimiento === proximo.proximoVencimiento);
          return mismos.some((c) => c.montoSiguiente === null) ? null : r2(mismos.reduce((s, c) => s + c.montoSiguiente!, 0));
        })(),
      }
    : null;

  const fin = vigentes
    .filter((c) => c.fechaTermino && dias(hoy, c.fechaTermino) >= 0)
    .sort((a, b) => a.fechaTermino!.localeCompare(b.fechaTermino!))[0];
  const finPlazo = fin ? { fecha: fin.fechaTermino!, dias: dias(hoy, fin.fechaTermino!) } : null;

  const especial = vigentes.some((c) => c.etapaManual && ETAPAS_ESPECIALES.has(c.etapaManual));
  const porLiquidar = vigentes.some(
    (c) => c.fechaTermino && !ETAPAS_ESPECIALES.has(c.etapaManual ?? "") && dias(hoy, c.fechaTermino) >= 0 && dias(hoy, c.fechaTermino) <= VENTANA_POR_LIQUIDAR,
  );
  const etapa: EtapaCiclo = especial
    ? "cobranza_especial"
    : porLiquidar
      ? "por_liquidar"
      : vigentes.length
        ? "activo"
        : creditos.length
          ? "ex_cliente"
          : "sin_creditos";

  return {
    ...e,
    creditosVigentes: vigentes.length,
    montoOriginal: suma((c) => c.montoCredito),
    adeudo: suma((c) => c.adeudo),
    vencido,
    maxAtraso,
    enMora: vigentes.length > 0 && estaEnMora(vencido, maxAtraso, umbral),
    historial,
    semaforo: historial ? semaforo(historial, umbralesSemaforo) : null,
    proximoPago,
    finPlazo,
    etapa,
  };
}

export function buildEmpresasLista(
  empresas: EmpresaRow[],
  creditos: CreditoEmpresaRow[],
  umbral: number,
  hoy: string,
  opts: { filtro: EmpresaFilter; q: string; orden?: EmpresaOrder; yo: string },
  umbralesSemaforo: UmbralesSemaforo = UMBRALES_SEMAFORO_DEFAULT,
): { items: EmpresaListItem[]; conteos: Record<EmpresaFilter, number>; total: number; totales: { adeudo: number; vencido: number } } {
  const porEmpresa = new Map<string, CreditoEmpresaRow[]>();
  for (const c of creditos) porEmpresa.set(c.empresaId, [...(porEmpresa.get(c.empresaId) ?? []), c]);
  const todos = empresas.map((e) => resumirEmpresa(e, porEmpresa.get(e.empresaId) ?? [], umbral, hoy, umbralesSemaforo));

  const q = sinAcentos(opts.q.trim());
  const buscados = q
    ? todos.filter((e) => {
        const suyos = porEmpresa.get(e.empresaId) ?? [];
        return (
          sinAcentos(e.nombre).includes(q) ||
          sinAcentos(e.razonSocial ?? "").includes(q) ||
          sinAcentos(e.rfc ?? "").includes(q) ||
          e.numerosCliente.some((n) => n.includes(q)) ||
          suyos.some((c) => sinAcentos(c.noCredito).includes(q))
        );
      })
    : todos;

  const pasa: Record<EmpresaFilter, (e: EmpresaListItem) => boolean> = {
    todos: () => true,
    mios: (e) => !!opts.yo && e.ejecutivoEmail === opts.yo,
    activos: (e) => e.creditosVigentes > 0,
    por_liquidar: (e) => e.etapa === "por_liquidar",
    mora: (e) => e.enMora,
    especial: (e) => e.etapa === "cobranza_especial",
    ex_clientes: (e) => e.etapa === "ex_cliente",
    sin_ejecutivo: (e) => !e.ejecutivoEmail,
    sin_rfc: (e) => !e.rfc,
  };
  const conteos = Object.fromEntries(FILTROS_EMPRESA.map((f) => [f.value, buscados.filter(pasa[f.value]).length])) as Record<EmpresaFilter, number>;
  const items = buscados.filter(pasa[opts.filtro]).sort(COMPARAR[opts.orden ?? "nombre"]);
  return {
    items,
    conteos,
    total: todos.length,
    totales: { adeudo: r2(todos.reduce((s, e) => s + e.adeudo, 0)), vencido: r2(todos.reduce((s, e) => s + e.vencido, 0)) },
  };
}
