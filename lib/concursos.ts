// Concursos de colocación: quién va ganando dentro del periodo del concurso, quién
// cumple la meta y quién gana. Lógica pura (sin base de datos) para probarla con
// `node --test`; la lectura y el cierre están en lib/db/contests.ts.
//
// Reglas (acordadas como punto de partida; se ajustan aquí):
// - Cuenta solo la colocación con fecha dentro del periodo, ambos días incluidos.
// - Criterio "monto" suma pesos; "operaciones" cuenta créditos.
// - Con meta, solo pueden ganar quienes la alcanzan (la meta se mide en la misma
//   unidad que el criterio); sin meta, gana quien más tenga, con al menos un crédito.
// - Empate: gana quien llegó primero a ese valor (su última operación es más antigua).
// - Los brokers excluidos del concurso no cuentan.

export type CriterioConcurso = "monto" | "operaciones";

export interface DatosConcurso {
  fechaInicio: string;
  fechaFin: string;
  criterio: CriterioConcurso;
  metaObjetivo: number | null;
  numGanadores: number;
}

export interface ColocacionDeConcurso {
  brokerId: string;
  /** YYYY-MM-DD */
  fecha: string;
  monto: number;
}

export interface PosicionConcurso {
  brokerId: string;
  nombre: string;
  /** Lo que cuenta para el concurso: monto o número de operaciones, según el criterio. */
  valor: number;
  monto: number;
  operaciones: number;
  /** Fecha de su última operación dentro del periodo (desempata). */
  alcanzoEl: string;
  cumpleMeta: boolean;
  /** Lugar en la tabla (1 = primero), contando solo a quien no está excluido. */
  lugar: number;
  /** Lugar de premio (1..numGanadores) o null si no gana. */
  premio: number | null;
}

export function enPeriodo(fecha: string, c: Pick<DatosConcurso, "fechaInicio" | "fechaFin">): boolean {
  return fecha >= c.fechaInicio && fecha <= c.fechaFin;
}

export function posicionesDeConcurso(
  c: DatosConcurso,
  colocaciones: ColocacionDeConcurso[],
  nombres: Map<string, string>,
  excluidos: Iterable<string> = [],
): PosicionConcurso[] {
  const fuera = new Set(excluidos);
  const porBroker = new Map<string, { monto: number; operaciones: number; alcanzoEl: string }>();
  for (const col of colocaciones) {
    if (fuera.has(col.brokerId) || !enPeriodo(col.fecha, c)) continue;
    const b = porBroker.get(col.brokerId) ?? { monto: 0, operaciones: 0, alcanzoEl: col.fecha };
    b.monto += col.monto;
    b.operaciones += 1;
    if (col.fecha > b.alcanzoEl) b.alcanzoEl = col.fecha;
    porBroker.set(col.brokerId, b);
  }

  const filas = [...porBroker].map(([brokerId, b]) => {
    const valor = c.criterio === "operaciones" ? b.operaciones : b.monto;
    return {
      brokerId,
      nombre: nombres.get(brokerId) ?? brokerId,
      valor,
      monto: b.monto,
      operaciones: b.operaciones,
      alcanzoEl: b.alcanzoEl,
      cumpleMeta: c.metaObjetivo === null || valor >= c.metaObjetivo,
    };
  });
  filas.sort((a, b) => b.valor - a.valor || a.alcanzoEl.localeCompare(b.alcanzoEl) || a.brokerId.localeCompare(b.brokerId));

  let lugarPremio = 0;
  return filas.map((f, i) => ({
    ...f,
    lugar: i + 1,
    premio: f.cumpleMeta && lugarPremio < c.numGanadores ? ++lugarPremio : null,
  }));
}

export function ganadoresDeConcurso(posiciones: PosicionConcurso[]): PosicionConcurso[] {
  return posiciones.filter((p) => p.premio !== null).sort((a, b) => (a.premio ?? 0) - (b.premio ?? 0));
}

export type EtapaPeriodo = "proximo" | "en_curso" | "terminado";

export function etapaDelPeriodo(c: Pick<DatosConcurso, "fechaInicio" | "fechaFin">, hoy: string): EtapaPeriodo {
  if (hoy < c.fechaInicio) return "proximo";
  return hoy > c.fechaFin ? "terminado" : "en_curso";
}

/** Días que faltan para que termine, contando hoy; 0 si ya terminó. */
export function diasRestantes(fechaFin: string, hoy: string): number {
  const dia = (f: string) => Date.parse(`${f}T00:00:00Z`);
  return Math.max(0, Math.round((dia(fechaFin) - dia(hoy)) / 86_400_000) + 1);
}

/** Avance hacia la meta, de 0 a 100; null si el concurso no tiene meta. */
export function avanceHaciaMeta(valor: number, meta: number | null): number | null {
  if (meta === null || meta <= 0) return null;
  return Math.min(100, Math.round((valor / meta) * 100));
}

export const LIMITE_GANADORES = 50;

export interface ConcursoNuevo {
  nombre: string;
  descripcion: string | null;
  fechaInicio: string;
  fechaFin: string;
  criterio: CriterioConcurso;
  metaObjetivo: number | null;
  premio: string;
  numGanadores: number;
}

function fechaValida(f: string): boolean {
  const r = /^(\d{4})-(\d{2})-(\d{2})$/.exec(f);
  if (!r) return false;
  const d = new Date(Date.UTC(Number(r[1]), Number(r[2]) - 1, Number(r[3])));
  return d.getUTCMonth() === Number(r[2]) - 1 && d.getUTCDate() === Number(r[3]);
}

export function validarConcurso(
  p: { nombre: string; descripcion?: string; fechaInicio: string; fechaFin: string; criterio: string; meta?: string; premio: string; numGanadores: string },
  hoy: string,
): ({ ok: true } & ConcursoNuevo) | { ok: false; error: string } {
  const nombre = p.nombre.trim().replace(/\s+/g, " ");
  const premio = p.premio.trim();
  const descripcion = (p.descripcion ?? "").trim() || null;
  if (!nombre) return { ok: false, error: "Falta el nombre" };
  if (nombre.length > 120) return { ok: false, error: "El nombre no puede pasar de 120 caracteres" };
  if (!premio) return { ok: false, error: "Falta el premio" };
  if (premio.length > 200) return { ok: false, error: "El premio no puede pasar de 200 caracteres" };
  if (descripcion && descripcion.length > 500) return { ok: false, error: "La descripción no puede pasar de 500 caracteres" };
  if (p.criterio !== "monto" && p.criterio !== "operaciones") return { ok: false, error: "El criterio debe ser monto u operaciones" };
  if (!fechaValida(p.fechaInicio) || !fechaValida(p.fechaFin)) return { ok: false, error: "Las fechas no son válidas" };
  if (p.fechaFin < p.fechaInicio) return { ok: false, error: "El concurso no puede terminar antes de empezar" };
  if (p.fechaFin < hoy) return { ok: false, error: "El periodo del concurso ya pasó" };

  const n = Number(p.numGanadores);
  if (!Number.isInteger(n) || n < 1 || n > LIMITE_GANADORES) {
    return { ok: false, error: `El número de ganadores debe ser un entero de 1 a ${LIMITE_GANADORES}` };
  }

  let metaObjetivo: number | null = null;
  const metaTexto = (p.meta ?? "").trim().replace(/[$,\s]/g, "");
  if (metaTexto) {
    const m = Number(metaTexto);
    if (!Number.isFinite(m) || m <= 0) return { ok: false, error: "La meta debe ser un número mayor que cero" };
    if (p.criterio === "operaciones" && !Number.isInteger(m)) return { ok: false, error: "La meta de operaciones debe ser un número entero" };
    metaObjetivo = m;
  }

  return { ok: true, nombre, descripcion, fechaInicio: p.fechaInicio, fechaFin: p.fechaFin, criterio: p.criterio, metaObjetivo, premio, numGanadores: n };
}
