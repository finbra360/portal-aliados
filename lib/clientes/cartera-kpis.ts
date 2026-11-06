// Resumen de cartera de Clientes 360: indicadores por empresa que no están en el
// resumen de Cobranza (fines de plazo, renovaciones, cobertura de contacto,
// calidad de datos, originación y trabajo por ejecutivo). Las cifras de saldo,
// vencido y PAR se toman de summarizePortfolio para que cuadren con Cobranza.
// Funciones puras, sin base de datos, para probarlas con `node --test`.
//
// Nada se calcula en paralelo a SIAC: capital insoluto, capital recuperado e
// ingresos financieros no vienen en el listado y se muestran como pendientes.

import type { EstadoOportunidad } from "./renovaciones.ts";

export interface EmpresaKpi {
  empresaId: string;
  creditosVigentes: number;
  enMora: boolean;
  rfc: string | null;
  ejecutivoEmail: string | null;
  ejecutivoNombre: string | null;
  tienePrincipal: boolean;
  /** Algún cliente de SIAC de la empresa tiene cuenta de pago asignada. */
  cuentaPago: boolean;
  /** Algún cliente de SIAC de la empresa tiene a quién mandarle WhatsApp. */
  whatsappValido: boolean;
  /** Último contacto de una persona del equipo, ISO. */
  ultimoContacto: string | null;
}

export interface CreditoKpi {
  enListado: boolean;
  fechaTermino: string | null;
  montoCredito: number | null;
  fechaMinistracion: string | null;
}

export interface OportunidadKpi {
  estado: EstadoOportunidad;
  montoReferencia: number | null;
  /** Fecha (YYYY-MM-DD, hora de Ciudad de México) en que se abrió. */
  abiertaEl: string;
}

export interface TareaKpi {
  responsableEmail: string | null;
  estado: "abierta" | "hecha" | "cancelada";
  venceEl: string;
  /** Fecha (YYYY-MM-DD, hora de Ciudad de México) en que se cerró. */
  cerradaEl: string | null;
}

const dias = (desde: string, hasta: string) => Math.round((Date.parse(hasta) - Date.parse(desde)) / 86_400_000);
const r2 = (n: number) => Math.round(n * 100) / 100;

export interface Proporcion {
  n: number;
  de: number;
}

/** Fines de plazo de los créditos vigentes, por ventana. Con monto original de los que terminan. */
export function finesDePlazo(creditos: CreditoKpi[], hoy: string, ventanas = [30, 60, 90]) {
  const vigentes = creditos.filter((c) => c.enListado && c.fechaTermino);
  const orden = [...ventanas].sort((a, b) => a - b);
  return orden.map((v, i) => {
    const desde = i === 0 ? 0 : orden[i - 1] + 1;
    const suyos = vigentes.filter((c) => {
      const d = dias(hoy, c.fechaTermino!);
      return d >= desde && d <= v;
    });
    return { desde, hasta: v, creditos: suyos.length, monto: r2(suyos.reduce((s, c) => s + (c.montoCredito ?? 0), 0)) };
  });
}

/**
 * Originación por mes (Σ MontoCredito por mes de FechaMinistracion), solo desde
 * el mes de la primera foto: antes de eso faltan los créditos que se liquidaron
 * antes de que existiera la base, y la cifra saldría baja.
 */
export function originacionPorMes(creditos: CreditoKpi[], primeraFoto: string | null, hoy: string) {
  if (!primeraFoto) return [];
  const meses: string[] = [];
  for (let m = primeraFoto.slice(0, 7); m <= hoy.slice(0, 7); ) {
    meses.push(m);
    const [y, mm] = m.split("-").map(Number);
    m = mm === 12 ? `${y + 1}-01` : `${y}-${String(mm + 1).padStart(2, "0")}`;
  }
  return meses.map((mes) => {
    const suyos = creditos.filter((c) => c.fechaMinistracion?.startsWith(mes));
    return { mes, creditos: suyos.length, monto: r2(suyos.reduce((s, c) => s + (c.montoCredito ?? 0), 0)) };
  });
}

/** Datos completos de las empresas con crédito vigente. */
export function calidadDeDatos(empresas: EmpresaKpi[]): Record<"rfc" | "ejecutivo" | "principal" | "cuentaPago" | "whatsapp", Proporcion> {
  const activas = empresas.filter((e) => e.creditosVigentes > 0);
  const p = (f: (e: EmpresaKpi) => boolean): Proporcion => ({ n: activas.filter(f).length, de: activas.length });
  return {
    rfc: p((e) => !!e.rfc),
    ejecutivo: p((e) => !!e.ejecutivoEmail),
    principal: p((e) => e.tienePrincipal),
    cuentaPago: p((e) => e.cuentaPago),
    whatsapp: p((e) => e.whatsappValido),
  };
}

/** Empresas con crédito vigente que tuvieron contacto de una persona del equipo en los últimos `dias` días. */
export function coberturaContacto(empresas: EmpresaKpi[], hoy: string, ventana = 60): Proporcion {
  const activas = empresas.filter((e) => e.creditosVigentes > 0);
  const limite = Date.parse(`${hoy}T00:00:00Z`) - ventana * 86_400_000;
  return { n: activas.filter((e) => e.ultimoContacto && Date.parse(e.ultimoContacto) >= limite).length, de: activas.length };
}

/** Embudo de oportunidades de renovación: por estado y monto de referencia de las abiertas. */
export function embudoRenovacion(oportunidades: OportunidadKpi[]) {
  const por = (estados: EstadoOportunidad[]) => oportunidades.filter((o) => estados.includes(o.estado));
  const abiertas = por(["abierta", "en_contacto", "interesado"]);
  return {
    nuevas: por(["abierta"]).length,
    enContacto: por(["en_contacto"]).length,
    interesados: por(["interesado"]).length,
    ganadas: por(["ganada"]).length,
    descartadas: por(["descartada"]).length,
    cerradas: por(["cerrada"]).length,
    total: oportunidades.length,
    montoAbierto: r2(abiertas.reduce((s, o) => s + (o.montoReferencia ?? 0), 0)),
  };
}

export interface FilaEjecutivo {
  email: string | null;
  nombre: string;
  clientes: number;
  enMora: number;
  contactados: number;
  tareasAbiertas: number;
  tareasVencidas: number;
  /** Tareas cerradas como hechas en los últimos 30 días, y cuántas de ellas a tiempo. */
  hechas30: number;
  aTiempo30: number;
}

/**
 * Trabajo por ejecutivo: sus clientes con crédito vigente, cuántos en mora y
 * cuántos contactados en 60 días, y sus tareas. «Sin ejecutivo» junta lo que no
 * tiene responsable.
 */
export function porEjecutivo(empresas: EmpresaKpi[], tareas: TareaKpi[], nombres: Map<string, string>, hoy: string, ventana = 60): FilaEjecutivo[] {
  const filas = new Map<string | null, FilaEjecutivo>();
  const fila = (email: string | null) => {
    let f = filas.get(email);
    if (!f) {
      f = { email, nombre: email ? (nombres.get(email) ?? email) : "Sin ejecutivo", clientes: 0, enMora: 0, contactados: 0, tareasAbiertas: 0, tareasVencidas: 0, hechas30: 0, aTiempo30: 0 };
      filas.set(email, f);
    }
    return f;
  };
  const limite = Date.parse(`${hoy}T00:00:00Z`) - ventana * 86_400_000;
  for (const e of empresas.filter((e) => e.creditosVigentes > 0)) {
    const f = fila(e.ejecutivoEmail);
    f.clientes++;
    if (e.enMora) f.enMora++;
    if (e.ultimoContacto && Date.parse(e.ultimoContacto) >= limite) f.contactados++;
  }
  for (const t of tareas) {
    const f = fila(t.responsableEmail);
    if (t.estado === "abierta") {
      f.tareasAbiertas++;
      if (t.venceEl < hoy) f.tareasVencidas++;
    } else if (t.estado === "hecha" && t.cerradaEl && dias(t.cerradaEl, hoy) <= 30) {
      f.hechas30++;
      if (t.cerradaEl <= t.venceEl) f.aTiempo30++;
    }
  }
  return [...filas.values()].sort((a, b) => (a.email === null ? 1 : b.email === null ? -1 : b.clientes - a.clientes || a.nombre.localeCompare(b.nombre, "es")));
}
