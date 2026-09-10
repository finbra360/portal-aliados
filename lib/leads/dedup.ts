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
export const UMBRAL_GRIS = 0.5;

/**
 * La ubicación decide cuándo el parecido de nombre amerita revisión humana.
 *
 * DENUE lista ESTABLECIMIENTOS, no razones sociales, y con frecuencia usa la
 * descripción del giro como nombre ("acarreo de materiales", "agencia de mercado
 * libre", "mensajería y paquetería"). Sobre esos nombres el trigram produce
 * falsos positivos en masa: de los primeros 105 casos que llegaron a la cola de
 * revisión, 96 tenían municipio o estado distinto y ninguno compartía teléfono
 * — eran negocios diferentes con nombre genérico parecido.
 *
 * Dos establecimientos con nombre similar en municipios distintos son dos
 * establecimientos, cada uno con su domicilio y teléfono: dos leads legítimos.
 * Por eso, cuando el único indicio es el nombre, se exige que la ubicación
 * coincida. Un match de dominio o de teléfono es prueba suficiente por sí solo
 * y no necesita el respaldo de la ubicación.
 *
 * Ubicación desconocida no cuenta como coincidencia: sin ese dato el nombre
 * genérico vuelve a ser la única señal, que es justo lo que no alcanza.
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
  const phoneMatch = Boolean(
    candidate.telefonoE164 && match.telefonoE164 && candidate.telefonoE164 === match.telefonoE164,
  );

  // El dominio es la señal más fuerte; el teléfono le sigue. El nombre nunca
  // llega solo al umbral alto (0.9 máximo contra un umbral de 0.85 requiere
  // similitud casi perfecta).
  let score = 0;
  if (domainMatch) score = 1;
  if (phoneMatch) score = Math.max(score, 0.75);
  score = Math.max(score, match.nameSim * 0.9);

  let route: DedupRoute = "bajo";
  if (score >= UMBRAL_ALTO) {
    route = "alto";
  } else if (score >= UMBRAL_GRIS) {
    route = domainMatch || phoneMatch || laUbicacionRespalda(candidate, match) ? "gris" : "bajo";
  }

  return { matchCompanyId: match.id, score, route };
}
