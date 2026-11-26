// Créditos históricos de SIAC: el reporte «Estado de Clientes» de SIAC Suite
// (Excel) trae todos los créditos otorgados, también los pagados, que el
// listado de cobranza ya no trae. Se guardan aparte (crm_creditos_historicos),
// solo para ligar negocios dispersados con su crédito; la cobranza no los ve.
// Funciones puras, sin base de datos, para probarlas con `node --test`.

export interface CreditoHistorico {
  noCredito: string;
  numeroCliente: string;
  nombre: string;
  rfc: string | null;
  personalidad: string | null;
  tipoContrato: string | null;
  monto: number | null;
  /** YYYY-MM-DD */
  otorgado: string | null;
  vence: string | null;
  ultimoPago: string | null;
  /** PAGADO, VIGENTE, VENCIDO… como lo escribe SIAC. */
  estado: string | null;
}

export interface LecturaEstadoClientes {
  creditos: CreditoHistorico[];
  /** Columnas obligatorias que no vienen en el archivo. */
  faltan: string[];
  /** Renglones con crédito que no se pudieron leer, con el porqué. */
  errores: string[];
}

/** Para comparar encabezados: sin acentos, minúsculas y sin espacios de más. */
const normal = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

const COLUMNAS = {
  noCredito: "no. de credito",
  numeroCliente: "clave de cliente",
  paterno: "apellido paterno",
  materno: "apellido materno",
  nombre: "nombre (s)",
  rfc: "rfc",
  personalidad: "personalidad",
  tipoContrato: "tipo de contrato",
  monto: "monto",
  otorgado: "fecha de otorgamiento",
  vence: "fecha de vencimiento",
  ultimoPago: "fecha de ultimo pago",
  estado: "estado del credito",
} as const;
type Columna = keyof typeof COLUMNAS;

const OBLIGATORIAS: { col: Columna; nombre: string }[] = [
  { col: "noCredito", nombre: "No. de Crédito" },
  { col: "numeroCliente", nombre: "Clave de Cliente" },
  { col: "nombre", nombre: "Nombre (s)" },
  { col: "monto", nombre: "Monto" },
  { col: "otorgado", nombre: "Fecha de otorgamiento" },
];

/** Número de crédito para comparar: mayúsculas y un solo espacio. */
export const normalNoCredito = (s: string) => s.toUpperCase().replace(/\s+/g, " ").trim();

/**
 * Fecha de una celda: número de serie de Excel (días desde 1899-12-30) o
 * texto DD/MM/AAAA o AAAA-MM-DD. null si viene vacía; "invalida" si no se entiende.
 */
export function fechaDeCelda(v: string): string | null | "invalida" {
  const s = v.trim();
  if (!s) return null;
  if (/^\d+(\.\d+)?$/.test(s)) {
    const dias = Math.floor(Number(s));
    if (dias < 20_000 || dias > 80_000) return "invalida";
    return new Date(Date.UTC(1899, 11, 30) + dias * 86_400_000).toISOString().slice(0, 10);
  }
  let m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return valida(Number(m[3]), Number(m[2]), Number(m[1]));
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return valida(Number(m[1]), Number(m[2]), Number(m[3]));
  return "invalida";
}

function valida(y: number, mes: number, d: number): string | "invalida" {
  const f = new Date(Date.UTC(y, mes - 1, d));
  if (f.getUTCFullYear() !== y || f.getUTCMonth() !== mes - 1 || f.getUTCDate() !== d) return "invalida";
  return f.toISOString().slice(0, 10);
}

/** Monto de una celda (número o texto con $ y comas). null si viene vacío; NaN si no se entiende. */
export function montoDeCelda(v: string): number | null {
  const s = v.replace(/[$,\s]/g, "");
  if (!s) return null;
  return /^-?\d+(\.\d+)?$/.test(s) ? Math.round(Number(s) * 100) / 100 : NaN;
}

const texto = (v: string | undefined) => (v ?? "").replace(/\s+/g, " ").trim();
const opcional = (v: string | undefined) => texto(v) || null;

/**
 * Lee los renglones del Excel «Estado de Clientes». Busca el renglón de
 * encabezados (el que tiene «No. de Crédito») en los primeros 20 y toma solo
 * las columnas que hacen falta para ligar; domicilios, teléfonos, CURP y saldos
 * se quedan fuera. Los renglones sin número de crédito se ignoran.
 */
export function leerEstadoClientes(renglones: string[][]): LecturaEstadoClientes {
  const idx = renglones.slice(0, 20).findIndex((r) => r.some((c) => normal(c ?? "") === COLUMNAS.noCredito));
  if (idx < 0) return { creditos: [], faltan: OBLIGATORIAS.map((o) => o.nombre), errores: [] };
  const encabezados = renglones[idx].map((c) => normal(c ?? ""));
  // La primera columna con ese nombre (el reporte repite «Promotor», por ejemplo).
  const pos = Object.fromEntries((Object.keys(COLUMNAS) as Columna[]).map((k) => [k, encabezados.indexOf(COLUMNAS[k])])) as Record<Columna, number>;
  const faltan = OBLIGATORIAS.filter((o) => pos[o.col] < 0).map((o) => o.nombre);
  if (faltan.length) return { creditos: [], faltan, errores: [] };

  const celda = (r: string[], k: Columna) => (pos[k] >= 0 ? (r[pos[k]] ?? "") : "");
  const creditos: CreditoHistorico[] = [];
  const errores: string[] = [];
  const vistos = new Set<string>();
  renglones.slice(idx + 1).forEach((r, i) => {
    const noCredito = normalNoCredito(celda(r, "noCredito"));
    if (!noCredito) return;
    const renglon = idx + i + 2;
    const numeroCliente = texto(celda(r, "numeroCliente"));
    const nombre = [celda(r, "nombre"), celda(r, "paterno"), celda(r, "materno")].map(texto).filter(Boolean).join(" ");
    const monto = montoDeCelda(celda(r, "monto"));
    const fechas = { otorgado: fechaDeCelda(celda(r, "otorgado")), vence: fechaDeCelda(celda(r, "vence")), ultimoPago: fechaDeCelda(celda(r, "ultimoPago")) };
    const problema =
      noCredito.length > 40 ? "el número de crédito es demasiado largo"
      : !numeroCliente ? "no trae clave de cliente"
      : numeroCliente.length > 20 ? "la clave de cliente es demasiado larga"
      : !nombre ? "no trae nombre"
      : Number.isNaN(monto) ? "el monto no es un número"
      : Object.values(fechas).includes("invalida") ? "trae una fecha que no se entiende"
      : vistos.has(noCredito) ? "el crédito viene repetido"
      : null;
    if (problema) {
      errores.push(`Renglón ${renglon} (crédito ${noCredito.slice(0, 40)}): ${problema}.`);
      return;
    }
    vistos.add(noCredito);
    creditos.push({
      noCredito,
      numeroCliente,
      nombre: nombre.slice(0, 300),
      rfc: opcional(celda(r, "rfc"))?.toUpperCase().slice(0, 20) ?? null,
      personalidad: opcional(celda(r, "personalidad"))?.slice(0, 60) ?? null,
      tipoContrato: opcional(celda(r, "tipoContrato"))?.slice(0, 80) ?? null,
      monto: monto as number | null,
      otorgado: fechas.otorgado as string | null,
      vence: fechas.vence as string | null,
      ultimoPago: fechas.ultimoPago as string | null,
      estado: opcional(celda(r, "estado"))?.toUpperCase().slice(0, 40) ?? null,
    });
  });
  return { creditos, faltan: [], errores };
}

/** Revisa en el servidor lo que manda el navegador (no se confía en él). */
export function validarCreditosHistoricos(x: unknown): { ok: true; creditos: CreditoHistorico[] } | { ok: false; error: string } {
  if (!Array.isArray(x) || x.length === 0) return { ok: false, error: "El archivo no trae créditos." };
  if (x.length > 20_000) return { ok: false, error: "El archivo trae demasiados créditos." };
  const fecha = (v: unknown) => v === null || (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v));
  const corto = (v: unknown, n: number) => v === null || (typeof v === "string" && v.length <= n);
  const ok = x.every(
    (c) =>
      c &&
      typeof c.noCredito === "string" && c.noCredito.length > 0 && c.noCredito.length <= 40 &&
      typeof c.numeroCliente === "string" && c.numeroCliente.length > 0 && c.numeroCliente.length <= 20 &&
      typeof c.nombre === "string" && c.nombre.length > 0 && c.nombre.length <= 300 &&
      corto(c.rfc, 20) && corto(c.personalidad, 60) && corto(c.tipoContrato, 80) && corto(c.estado, 40) &&
      (c.monto === null || (typeof c.monto === "number" && Number.isFinite(c.monto) && Math.abs(c.monto) < 1e12)) &&
      fecha(c.otorgado) && fecha(c.vence) && fecha(c.ultimoPago),
  );
  if (!ok) return { ok: false, error: "Los datos del archivo no son válidos. Vuelve a subirlo." };
  if (new Set(x.map((c) => c.noCredito)).size !== x.length) return { ok: false, error: "El archivo trae créditos repetidos." };
  return { ok: true, creditos: x as CreditoHistorico[] };
}

/** «Pagado», «Vigente»… para mostrar. */
export const etiquetaEstado = (estado: string | null) => (estado ? estado.charAt(0) + estado.slice(1).toLowerCase() : null);
