// Playbooks de seguimiento: tareas que se crean solas en momentos clave de la
// relación con el cliente. Las corre el cron después de la foto diaria
// (lib/db/playbooks.ts). Funciones puras, sin base de datos, para probarlas
// con `node --test`.
//
// Cada tarea lleva una llave única (dedupe_key): una vez creada, aunque ya se
// haya cerrado, el mismo momento no vuelve a generar otra.

import { NIVELES_SALUD, type NivelSalud } from "./salud.ts";

export type ClavePlaybook = "bienvenida" | "primer_pago" | "revision" | "liquidacion" | "rescate";

export const PLAYBOOKS: Record<ClavePlaybook, string> = {
  bienvenida: "Crédito nuevo",
  primer_pago: "Primer pago",
  revision: "Revisión periódica",
  liquidacion: "Salida del listado",
  rescate: "Pasó a En riesgo",
};

export interface AjustesPlaybooks {
  activo: boolean;
  bienvenida: boolean;
  /** Días antes del primer vencimiento en que se confirma que tiene la CLABE. 0 = apagado. */
  primerPagoDias: number;
  /** Días sin contacto del equipo para pedir una llamada de revisión. 0 = apagado. */
  revisionDias: number;
  /** Tope de tareas de revisión nuevas por día, para no saturar al equipo al arrancar. */
  revisionMaxPorDia: number;
  liquidacion: boolean;
  /** Llamada de rescate cuando la salud del cliente pasa a En riesgo. */
  rescate: boolean;
}

export const AJUSTES_PLAYBOOKS_DEFAULT: AjustesPlaybooks = {
  activo: true,
  bienvenida: true,
  primerPagoDias: 5,
  revisionDias: 90,
  revisionMaxPorDia: 5,
  liquidacion: true,
  rescate: true,
};

const entero = (v: unknown, def: number, max: number) => {
  const n = Number(v);
  return v !== undefined && v !== null && Number.isInteger(n) && n >= 0 && n <= max ? n : def;
};
const bool = (v: unknown, def: boolean) => (typeof v === "boolean" ? v : def);

/** Lee el ajuste `playbooks` de crm_settings; lo que falte o no sirva queda con el valor por omisión. */
export function leerAjustesPlaybooks(raw: unknown): AjustesPlaybooks {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const d = AJUSTES_PLAYBOOKS_DEFAULT;
  return {
    activo: bool(r.activo, d.activo),
    bienvenida: bool(r.bienvenida, d.bienvenida),
    primerPagoDias: entero(r.primer_pago_dias, d.primerPagoDias, 30),
    revisionDias: entero(r.revision_dias, d.revisionDias, 365),
    revisionMaxPorDia: entero(r.revision_max_por_dia, d.revisionMaxPorDia, 100),
    liquidacion: bool(r.liquidacion, d.liquidacion),
    rescate: bool(r.rescate, d.rescate),
  };
}

export interface CreditoPlaybook {
  creditId: string;
  empresaId: string;
  noCredito: string;
  enListado: boolean;
  /** Primera foto en la que apareció el crédito. */
  primeraFoto: string | null;
  /** Fecha de su salida del listado (evento salida_listado más reciente), si salió. */
  salioEl: string | null;
  cubiertos: number | null;
  proximoVencimiento: string | null;
  fechaMinistracion: string | null;
}

export interface EmpresaPlaybook {
  empresaId: string;
  enMora: boolean;
  /** Algún crédito vigente en jurídico, extrajudicial, reestructura o pausa. */
  especial: boolean;
  cuentaPago: boolean;
  whatsappValido: boolean;
  /** Último contacto de una persona del equipo, ISO. */
  ultimoContacto: string | null;
  /** Cuándo se creó su última tarea de revisión periódica (YYYY-MM-DD). */
  ultimaRevision: string | null;
  /** Tiene una oportunidad de renovación abierta (esa ya pide contactarlo). */
  oportunidadAbierta: boolean;
  /** Salud de hoy (lib/clientes/salud.ts) y lo que le restó; null sin créditos vigentes. */
  salud?: { nivel: NivelSalud; puntos: number; razones: string[] } | null;
  /** Nivel guardado más reciente antes de hoy; null si todavía no hay historia. */
  nivelAnterior?: NivelSalud | null;
}

export interface TareaPlaybook {
  clave: ClavePlaybook;
  empresaId: string;
  creditId: string | null;
  dedupeKey: string;
  titulo: string;
  descripcion: string;
  tipo: "llamada" | "seguimiento" | "revision" | "dato_faltante";
  venceEl: string;
}

const MS_DIA = 86_400_000;
const dias = (desde: string, hasta: string) => Math.round((Date.parse(hasta.slice(0, 10)) - Date.parse(desde.slice(0, 10))) / MS_DIA);
const mas = (fecha: string, n: number) => new Date(Date.parse(fecha) + n * MS_DIA).toISOString().slice(0, 10);
const FECHA = new Intl.DateTimeFormat("es-MX", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const corta = (iso: string) => FECHA.format(new Date(`${iso}T00:00:00Z`)).replace(".", "");

/** Días hacia atrás en que todavía se atiende un crédito nuevo o una salida (por si el cron no corrió algún día). */
export const DIAS_RECIENTE = 7;

/**
 * Las tareas que tocan hoy. La base solo inserta las que no existen (por su
 * llave), así que correrlo varias veces no duplica nada.
 *
 * - Crédito nuevo: un crédito que aparece en el listado después de la primera
 *   foto del sistema (los que ya estaban al arrancar no cuentan). Llamada de
 *   bienvenida y, si faltan, cuenta de pago y contacto de pagos con WhatsApp.
 * - Primer pago: aún sin mensualidades pagadas y su primer vencimiento cae en
 *   los próximos `primerPagoDias` días: confirmar que tiene la CLABE.
 * - Revisión periódica: cliente con crédito vigente de al menos `revisionDias`
 *   días, al corriente, sin cobranza especial ni oportunidad abierta, sin
 *   contacto del equipo ni otra revisión en ese plazo. Los de contacto más
 *   viejo primero, con tope diario.
 * - Salida del listado: el crédito dejó de aparecer; confirmar si se liquidó
 *   y, si sí, carta, liberación de garantía y referidos.
 * - Rescate: su salud pasó a En riesgo desde otro nivel (contra el último día
 *   guardado). Sin historia no cuenta como caída: al arrancar no se crea una
 *   tarea por cada cliente que ya estaba en riesgo.
 */
export function planPlaybooks(p: {
  creditos: CreditoPlaybook[];
  empresas: EmpresaPlaybook[];
  ajustes: AjustesPlaybooks;
  /** Primera foto completa del sistema. */
  primeraFotoSistema: string | null;
  hoy: string;
}): TareaPlaybook[] {
  const { ajustes: a, hoy } = p;
  if (!a.activo) return [];
  const empresa = new Map(p.empresas.map((e) => [e.empresaId, e]));
  const tareas: TareaPlaybook[] = [];

  for (const c of p.creditos) {
    const e = empresa.get(c.empresaId);
    if (!e) continue;

    const nuevo =
      a.bienvenida && c.enListado && c.primeraFoto && p.primeraFotoSistema && c.primeraFoto > p.primeraFotoSistema && dias(c.primeraFoto, hoy) <= DIAS_RECIENTE;
    if (nuevo) {
      const base = { clave: "bienvenida" as const, empresaId: c.empresaId, creditId: c.creditId };
      tareas.push({
        ...base,
        dedupeKey: `playbook:bienvenida:${c.creditId}`,
        titulo: `Llamada de bienvenida: crédito ${c.noCredito}`,
        descripcion: "Presentarse como su ejecutivo, explicar cómo y cuándo paga, y resolver dudas del crédito.",
        tipo: "llamada",
        venceEl: hoy,
      });
      if (!e.cuentaPago) {
        tareas.push({
          ...base,
          dedupeKey: `playbook:bienvenida:${c.creditId}:cuenta_pago`,
          titulo: "Asignar cuenta de pago en su expediente de cobranza",
          descripcion: "Sin cuenta de pago no recibe los recordatorios con la CLABE.",
          tipo: "dato_faltante",
          venceEl: mas(hoy, 2),
        });
      }
      if (!e.whatsappValido) {
        tareas.push({
          ...base,
          dedupeKey: `playbook:bienvenida:${c.creditId}:contacto_pagos`,
          titulo: "Confirmar quién hace los pagos y su WhatsApp",
          descripcion: "Registrar a la persona de pagos con un WhatsApp válido para los recordatorios.",
          tipo: "dato_faltante",
          venceEl: mas(hoy, 2),
        });
      }
    }

    if (a.primerPagoDias > 0 && c.enListado && c.cubiertos === 0 && c.proximoVencimiento) {
      const faltan = dias(hoy, c.proximoVencimiento);
      if (faltan >= 0 && faltan <= a.primerPagoDias) {
        tareas.push({
          clave: "primer_pago",
          empresaId: c.empresaId,
          creditId: c.creditId,
          dedupeKey: `playbook:primer_pago:${c.creditId}`,
          titulo: `Primer pago del crédito ${c.noCredito} el ${corta(c.proximoVencimiento)}: confirmar CLABE y concepto`,
          descripcion: "Confirmar que tiene la CLABE y la referencia correctas antes de su primer vencimiento.",
          tipo: "llamada",
          venceEl: hoy,
        });
      }
    }

    if (a.liquidacion && !c.enListado && c.salioEl && dias(c.salioEl, hoy) >= 0 && dias(c.salioEl, hoy) <= DIAS_RECIENTE) {
      tareas.push({
        clave: "liquidacion",
        empresaId: c.empresaId,
        creditId: c.creditId,
        dedupeKey: `playbook:liquidacion:${c.creditId}:${c.salioEl}`,
        titulo: `El crédito ${c.noCredito} salió del listado de SIAC: confirmar si se liquidó`,
        descripcion:
          "Si se liquidó: carta de liquidación, liberar la garantía y el GPS, preguntar cómo le fue y pedir referidos. Si fue reestructura o castigo, avisar a Cobranza.",
        tipo: "revision",
        venceEl: mas(hoy, 1),
      });
    }
  }

  if (a.rescate) {
    for (const e of p.empresas) {
      if (e.salud?.nivel !== "riesgo" || !e.nivelAnterior || e.nivelAnterior === "riesgo") continue;
      tareas.push({
        clave: "rescate",
        empresaId: e.empresaId,
        creditId: null,
        dedupeKey: `playbook:rescate:${e.empresaId}:${hoy}`,
        titulo: `Llamada de rescate: su salud pasó a En riesgo (${e.salud.puntos}/100)`,
        descripcion:
          `Antes estaba en ${NIVELES_SALUD[e.nivelAnterior]}. ` +
          (e.salud.razones.length ? `Qué le resta: ${e.salud.razones.join("; ")}. ` : "") +
          "Hablar con el cliente, entender qué cambió y acordar el siguiente paso.",
        tipo: "llamada",
        venceEl: hoy,
      });
    }
  }

  if (a.revisionDias > 0 && a.revisionMaxPorDia > 0) {
    // Antigüedad de la relación: su crédito vigente más antiguo.
    const desde = new Map<string, string>();
    for (const c of p.creditos.filter((c) => c.enListado && c.fechaMinistracion)) {
      const d = desde.get(c.empresaId);
      if (!d || c.fechaMinistracion! < d) desde.set(c.empresaId, c.fechaMinistracion!);
    }
    const candidatas = p.empresas
      .filter((e) => {
        const inicio = desde.get(e.empresaId);
        return (
          inicio &&
          dias(inicio, hoy) >= a.revisionDias &&
          !e.enMora &&
          !e.especial &&
          !e.oportunidadAbierta &&
          (!e.ultimoContacto || dias(e.ultimoContacto, hoy) >= a.revisionDias) &&
          (!e.ultimaRevision || dias(e.ultimaRevision, hoy) >= a.revisionDias)
        );
      })
      .sort((x, y) => (x.ultimoContacto ?? "").localeCompare(y.ultimoContacto ?? "") || x.empresaId.localeCompare(y.empresaId))
      .slice(0, a.revisionMaxPorDia);
    for (const e of candidatas) {
      tareas.push({
        clave: "revision",
        empresaId: e.empresaId,
        creditId: null,
        dedupeKey: `playbook:revision:${e.empresaId}:${hoy}`,
        titulo: e.ultimoContacto ? `Revisión periódica: sin contacto desde el ${corta(e.ultimoContacto.slice(0, 10))}` : "Revisión periódica: sin contacto registrado",
        descripcion: "Llamada de seguimiento: cómo va la operación, si va a necesitar capital y si conoce a alguien a quien le sirva un crédito.",
        tipo: "llamada",
        venceEl: hoy,
      });
    }
  }
  return tareas;
}

/** Nombre del playbook a partir del origen de la tarea ('playbook:<clave>'), o null si no es de un playbook. */
export function playbookDeOrigen(origen: string): string | null {
  if (origen.startsWith("oportunidad:")) return "Renovación";
  if (origen.startsWith("negocio:")) return "Negocio pospuesto";
  const clave = origen.startsWith("playbook:") ? (origen.slice(9) as ClavePlaybook) : null;
  return clave && clave in PLAYBOOKS ? PLAYBOOKS[clave] : null;
}
