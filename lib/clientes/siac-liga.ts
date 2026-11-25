// Liga de un negocio dispersado con su crédito de SIAC (fase O6): qué créditos
// sugerir y si la empresa que creó SIAC se puede juntar con la del negocio.
// Nunca se liga solo: el equipo confirma la sugerencia. Funciones puras, sin
// base de datos, para probarlas con `node --test`.

/** Palabras que no distinguen a una empresa: tipo de sociedad y artículos. */
const COMUNES = new Set([
  "SA", "DE", "CV", "SAPI", "SAB", "S", "RL", "SC", "SOFOM", "ENR", "ER", "SPR", "AC", "DEL", "LA", "LAS", "LOS", "EL", "Y", "E", "CIA", "GRUPO",
]);

/** Palabras que cuentan de un nombre: sin acentos, sin puntuación ni tipo de sociedad. */
export function palabrasDe(nombre: string): Set<string> {
  const limpio = nombre
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9Ñ ]+/g, " ");
  return new Set(limpio.split(/\s+/).filter((p) => p.length > 1 && !COMUNES.has(p)));
}

/** Qué tanto se parecen dos nombres, de 0 a 1 (palabras en común contra el nombre más corto). */
export function parecidoNombre(a: string, b: string): number {
  const x = palabrasDe(a);
  const y = palabrasDe(b);
  if (x.size === 0 || y.size === 0) return 0;
  let comunes = 0;
  for (const p of x) if (y.has(p)) comunes++;
  return comunes / Math.min(x.size, y.size);
}

const MS_DIA = 86_400_000;
const diasEntre = (a: string, b: string) => Math.round((Date.parse(b.slice(0, 10)) - Date.parse(a.slice(0, 10))) / MS_DIA);

export interface NegocioParaLigar {
  empresaId: string;
  /** Nombre y razón social de la empresa del negocio. */
  nombres: string[];
  /** Monto de referencia: el aprobado en comité, el de la oferta o el estimado. */
  monto: number | null;
  /** Cuándo pasó a Dispersado (YYYY-MM-DD). */
  dispersadoEl: string;
}

export interface CreditoSiac {
  creditId: string;
  noCredito: string;
  cliente: string;
  numeroCliente: string;
  empresaId: string | null;
  monto: number | null;
  fechaMinistracion: string | null;
}

export interface Sugerencia extends CreditoSiac {
  puntos: number;
  razones: string[];
}

/** Días alrededor de la dispersión en que se buscan créditos. */
export const VENTANA_DIAS = 60;
const MINIMO = 40;
const FECHA = new Intl.DateTimeFormat("es-MX", { day: "numeric", month: "short", timeZone: "UTC" });

/**
 * Créditos que podrían ser el del negocio, de más a menos probable (hasta 5).
 * Puntos: nombre parecido (hasta 50; si ya es de la misma empresa, completo),
 * monto (hasta 30) y fecha de ministración cerca de la dispersión (hasta 20).
 * Solo los de 40 puntos o más, o los de la misma empresa.
 */
export function sugerirCreditos(n: NegocioParaLigar, creditos: CreditoSiac[]): Sugerencia[] {
  const r: Sugerencia[] = [];
  for (const c of creditos) {
    const razones: string[] = [];
    const misma = c.empresaId === n.empresaId;
    const nombre = misma ? 1 : Math.max(0, ...n.nombres.map((x) => parecidoNombre(x, c.cliente)));
    if (misma) razones.push("es de la misma empresa");
    else if (nombre >= 0.99) razones.push("mismo nombre");
    else if (nombre >= 0.5) razones.push("nombre parecido");

    let monto = 0;
    if (n.monto && c.monto) {
      const proporcion = Math.min(n.monto, c.monto) / Math.max(n.monto, c.monto);
      monto = proporcion >= 0.98 ? 1 : Math.max(0, (proporcion - 0.7) / 0.28);
      const dif = Math.round((1 - proporcion) * 100);
      razones.push(dif <= 1 ? "mismo monto" : `monto ${dif} % distinto`);
    }

    let fecha = 0;
    if (c.fechaMinistracion) {
      const d = Math.abs(diasEntre(n.dispersadoEl, c.fechaMinistracion));
      if (d > VENTANA_DIAS && !misma) continue;
      fecha = d <= 7 ? 1 : Math.max(0, 1 - (d - 7) / (VENTANA_DIAS - 7));
      razones.push(`ministrado el ${FECHA.format(new Date(`${c.fechaMinistracion}T00:00:00Z`)).replace(".", "")}`);
    }

    const puntos = Math.round(nombre * 50 + monto * 30 + fecha * 20);
    if (puntos >= MINIMO || misma) r.push({ ...c, puntos, razones });
  }
  return r.sort((a, b) => b.puntos - a.puntos || a.noCredito.localeCompare(b.noCredito)).slice(0, 5);
}

export interface EmpresaParaJuntar {
  id: string;
  nombre: string;
  origen: "siac" | "manual";
  /** Clientes de SIAC ligados a la empresa. */
  clientes: number;
}

export type Juntar = { ok: true; accion: "misma" | "juntar" } | { ok: false; error: string };

/**
 * Qué pasa con las empresas al ligar el crédito:
 * - misma: el crédito ya es de la empresa del negocio (renovación o ya se juntaron).
 * - juntar: la empresa del negocio es un prospecto (sin clientes de SIAC) y la
 *   del crédito la creó SIAC: se pasa todo a la del negocio y se borra la otra.
 * Cualquier otro caso es un error: no se juntan dos empresas que ya eran algo.
 */
export function comoJuntar(negocio: EmpresaParaJuntar, credito: EmpresaParaJuntar): Juntar {
  if (negocio.id === credito.id) return { ok: true, accion: "misma" };
  if (negocio.clientes > 0) {
    return { ok: false, error: `Ese crédito es de ${credito.nombre}, y ${negocio.nombre} ya es cliente con otra razón social. Revisa que sea el crédito correcto.` };
  }
  if (credito.origen !== "siac") {
    return { ok: false, error: `Ese crédito es de ${credito.nombre}, que se dio de alta a mano. Revisa que sea el crédito correcto.` };
  }
  return { ok: true, accion: "juntar" };
}
