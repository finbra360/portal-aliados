// WF2/WF3 — Normalization + Deduplication. Implementación de referencia del
// matching de duplicados que corre en el nodo "Calcular Score de Match" de n8n.
// Vive aquí para que la regla sea legible y revisable fuera del editor de n8n;
// la fuente de verdad en ejecución sigue siendo el workflow.

export interface DedupCandidate {
  /** Nombre normalizado (sin S.A. de C.V., sin acentos, minúsculas). */
  dedupeMatchKey: string;
  domain: string | null;
  telefonoE164: string | null;
  municipio: string | null;
  estado: string | null;
}

export interface DedupMatch extends DedupCandidate {
  id: string;
  /** similarity() de pg_trgm entre los dedupe_match_key, 0 a 1. */
  nameSim: number;
}

export type DedupRoute =
  /** Es la misma empresa: se fusiona con el registro existente. */
  | "alto"
  /** Ambiguo: se crea la empresa y se manda a revisión humana. */
  | "gris"
  /** Empresas distintas: se crea el registro sin revisión. */
  | "bajo";

export const UMBRAL_ALTO = 0.85;
/** Similitud de nombre mínima para que valga la pena el tiempo de una persona. */
export const UMBRAL_NOMBRE_REVISION = 0.8;

/**
 * El teléfono es el discriminador; la ubicación no lo es.
 *
 * DENUE lista ESTABLECIMIENTOS, no razones sociales, y con frecuencia usa la
 * descripción del giro como nombre ("acarreo de materiales", "mensajería y
 * paquetería"). Sobre esos nombres el trigram produce falsos positivos en masa.
 *
 * La primera versión de esta regla exigía que coincidiera la ubicación antes de
 * mandar un caso a revisión. Funcionó mientras la base era chica y dejó de
 * funcionar al crecer: de los 222 casos acumulados en la cola, **219 compartían
 * municipio y estado**. En una ciudad con cientos de transportistas, compartir
 * municipio no distingue nada.
 *
 * Lo que sí distingue es el teléfono. De esos mismos 222 casos:
 *
 * - 14 compartían teléfono, y los 14 eran el mismo negocio — casi todos erratas
 *   de captura de DENUE (`FSI EXPRESS` / `FSI EXPRES`, `SINDICATO DE
 *   TRASPORTISTAS` / `SINDICATO DE TRANSPORTISTAS`), uno de ellos con similitud
 *   de nombre 0.00.
 * - 37 tenían teléfonos distintos, y eran empresas distintas con el mismo
 *   prefijo del giro (`AUTO TANQUES SAGA` / `AUTO TANQUES MOYA`).
 * - 0 compartían dominio o dirección; el campo `direccion` viene vacío.
 *
 * De ahí las tres reglas: teléfono igual decide por sí solo, teléfono distinto
 * descarta el duplicado aunque el nombre sea casi idéntico (dos sucursales son
 * dos establecimientos, o sea dos leads legítimos), y solo llega a revisión lo
 * que tiene nombres casi iguales sin teléfono que desempate.
 */
function laUbicacionRespalda(candidate: DedupCandidate, match: DedupMatch): boolean {
  const conocida = Boolean(candidate.municipio && match.municipio);
  if (!conocida) return false;
  return candidate.municipio === match.municipio && (candidate.estado ?? null) === (match.estado ?? null);
}

export function calcularMatch(
  candidate: DedupCandidate,
  match: DedupMatch | null,
): { matchCompanyId: string | null; score: number; route: DedupRoute } {
  if (!match) {
    return { matchCompanyId: null, score: 0, route: "bajo" };
  }

  const domainMatch = Boolean(candidate.domain && match.domain && candidate.domain === match.domain);

  const telefonosComparables = Boolean(candidate.telefonoE164 && match.telefonoE164);
  const phoneMatch = telefonosComparables && candidate.telefonoE164 === match.telefonoE164;
  const phoneConflict = telefonosComparables && !phoneMatch;

  // Dominio y teléfono son prueba dura. El nombre por sí solo nunca llega al
  // umbral alto salvo que sea prácticamente idéntico (0.944 × 0.9 = 0.85).
  let score = 0;
  if (domainMatch || phoneMatch) score = 1;
  score = Math.max(score, match.nameSim * 0.9);

  let route: DedupRoute = "bajo";
  if (domainMatch || phoneMatch) {
    route = "alto";
  } else if (phoneConflict) {
    // Ambos tienen teléfono y son distintos: establecimientos distintos.
    route = "bajo";
  } else if (score >= UMBRAL_ALTO) {
    route = "alto";
  } else if (match.nameSim >= UMBRAL_NOMBRE_REVISION && laUbicacionRespalda(candidate, match)) {
    // Única zona que amerita ojo humano: nombres casi iguales, misma ciudad, y
    // sin teléfono en alguno de los dos. Ahí conviven erratas reales
    // (`LOGISTICA TRRRESTRE` / `LOGISTICA TERRESTRE`) con artefactos del trigram
    // (`BODEGA DE ADMEX` / `ALMACENADORA Y DISTRIBUIDORA MEX`).
    route = "gris";
  }

  return { matchCompanyId: match.id, score, route };
}
