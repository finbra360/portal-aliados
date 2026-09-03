// Prompts de los 6 puntos de juicio de IA del pipeline (Etapa 2/6). Cada uno
// es una llamada cerrada y auditable -- nunca un agente conversacional
// libre. Regla común a los seis: si la evidencia no alcanza, el modelo debe
// decir "no_disponible" / "no_se" / null en vez de inventar. Esa regla se
// repite explícita en cada system prompt a propósito -- es la defensa
// principal contra alucinaciones en un sistema que alimenta a ventas.

// ---------------------------------------------------------------------------
// 1. Deduplication — comparación en zona gris (WF3). Modelo económico.
// ---------------------------------------------------------------------------

export const DEDUP_SYSTEM_PROMPT = `Eres un verificador de identidad de empresas mexicanas.
Se te muestran dos registros: un candidato nuevo y un registro ya existente en la base de datos.
Tu única tarea es decidir si son la MISMA empresa, basándote estrictamente en los datos entregados.
No uses conocimiento externo ni supongas nada que no esté en los campos.
Si la evidencia es insuficiente o contradictoria, responde "no_se" en vez de forzar una decisión.
Responde solo con el JSON solicitado, sin texto adicional.`;

export interface DedupComparisonInput {
  candidato: { nombre: string; dominio: string | null; telefono: string | null; direccion: string | null; municipio: string | null };
  existente: { nombre: string; dominio: string | null; telefono: string | null; direccion: string | null; municipio: string | null };
  scoreSimilitudPrecalculado: number;
}

export function buildDedupUserMessage(input: DedupComparisonInput): string {
  return `Candidato nuevo: ${JSON.stringify(input.candidato)}
Registro existente: ${JSON.stringify(input.existente)}
Score de similitud precalculado (0-1, por nombre/dominio/teléfono): ${input.scoreSimilitudPrecalculado}

Responde en este formato JSON exacto:
{"es_misma_empresa": "si" | "no" | "no_se", "confidence": number entre 0 y 1, "razon": "una frase citando el campo que decidió"}`;
}

export interface DedupComparisonOutput {
  es_misma_empresa: "si" | "no" | "no_se";
  confidence: number;
  razon: string;
}

// ---------------------------------------------------------------------------
// 2. Enrichment — extracción de campos cerrados (WF4). Modelo económico.
// ---------------------------------------------------------------------------

export const ENRICHMENT_EXTRACTION_SYSTEM_PROMPT = `Eres un extractor de datos B2B.
Se te da texto extraído de un sitio web público de una empresa mexicana, y una lista cerrada de
preguntas específicas de su industria.
Responde ÚNICAMENTE con lo que el texto dice explícitamente.
Si el texto no menciona algo, responde exactamente "no_disponible" para ese campo -- nunca infieras,
asumas, ni completes con conocimiento general sobre la industria.
No agregues campos fuera de los que se te piden.
Responde solo con el JSON solicitado, sin texto adicional.`;

export interface EnrichmentQuestion {
  campo: string;
  pregunta: string;
}

export interface EnrichmentExtractionInput {
  textoSitioWeb: string;
  preguntasCerradas: EnrichmentQuestion[];
}

export function buildEnrichmentUserMessage(input: EnrichmentExtractionInput): string {
  const preguntas = input.preguntasCerradas.map((q) => `- ${q.campo}: ${q.pregunta}`).join("\n");
  return `Texto del sitio web:
"""
${input.textoSitioWeb}
"""

Preguntas a responder (solo con lo que el texto dice explícitamente):
${preguntas}

Responde en este formato JSON exacto, una clave por cada "campo" de arriba:
{"<campo>": {"value": string | "no_disponible", "confidence": number entre 0 y 1, "evidencia": "cita textual corta o vacío si no_disponible"}}`;
}

export type EnrichmentExtractionOutput = Record<string, { value: string; confidence: number; evidencia: string }>;

// ---------------------------------------------------------------------------
// 3. Industry Classification — fallback cuando no hay SCIAN o es ambiguo
//    (WF5). Modelo económico.
// ---------------------------------------------------------------------------

export const INDUSTRY_CLASSIFICATION_SYSTEM_PROMPT = `Eres un clasificador de giro comercial de empresas mexicanas.
Se te da la descripción de una empresa y una lista CERRADA de industrias válidas para este sistema.
Elige la que mejor corresponda, solo de esa lista.
Si ninguna aplica con claridad, responde "ninguna_aplica" -- no inventes una industria fuera de la lista.
Responde solo con el JSON solicitado, sin texto adicional.`;

export interface IndustryClassificationInput {
  descripcionEmpresa: string;
  industriasValidas: string[];
}

export function buildIndustryClassificationUserMessage(input: IndustryClassificationInput): string {
  return `Descripción de la empresa: "${input.descripcionEmpresa}"
Industrias válidas: ${input.industriasValidas.join(", ")}

Responde en este formato JSON exacto:
{"industria": "<una de la lista>" | "ninguna_aplica", "confidence": number entre 0 y 1, "razon": "una frase"}`;
}

export interface IndustryClassificationOutput {
  industria: string;
  confidence: number;
  razon: string;
}

// ---------------------------------------------------------------------------
// 4. Buyer Identification — selección del decisor (WF7). Modelo de mayor
//    capacidad: bajo volumen, requiere juicio jerárquico.
// ---------------------------------------------------------------------------

export const BUYER_IDENTIFICATION_SYSTEM_PROMPT = `Eres un analista B2B experto en estructuras organizacionales de PyMEs mexicanas.
Se te da una lista de nombres y cargos encontrados públicamente sobre una empresa, y el orden de
prioridad de buyer persona definido para su industria.
Elige a la persona más probable como decisor financiero de un crédito de capital de trabajo.
Solo puedes elegir entre los candidatos que se te dan -- NUNCA inventes un nombre o cargo que no
esté en la lista.
Si no hay ningún candidato con nombre real, responde con contacto_elegido en null.
Responde solo con el JSON solicitado, sin texto adicional.`;

export interface BuyerCandidate {
  nombre: string;
  cargo: string;
  fuente: string;
}

export interface BuyerIdentificationInput {
  candidatos: BuyerCandidate[];
  jerarquiaBuyerPersona: string[];
  empleadosEstimado: number | null;
}

export function buildBuyerIdentificationUserMessage(input: BuyerIdentificationInput): string {
  return `Candidatos encontrados: ${JSON.stringify(input.candidatos)}
Jerarquía de buyer persona para esta industria (de mayor a menor prioridad): ${input.jerarquiaBuyerPersona.join(" > ")}
Tamaño estimado de la empresa: ${input.empleadosEstimado ?? "desconocido"} empleados

Responde en este formato JSON exacto:
{"contacto_elegido": {"nombre": string, "cargo": string} | null, "confidence": number entre 0 y 1, "razon": "una frase"}`;
}

export interface BuyerIdentificationOutput {
  contacto_elegido: { nombre: string; cargo: string } | null;
  confidence: number;
  razon: string;
}

// ---------------------------------------------------------------------------
// 5. Lead Scoring — explicación en lenguaje natural (WF8). Modelo de mayor
//    capacidad, plantilla fija: no puede introducir razones no calculadas.
// ---------------------------------------------------------------------------

export const SCORE_EXPLANATION_SYSTEM_PROMPT = `Eres un asistente que redacta explicaciones breves para vendedores de Finbra.
Se te dan los componentes YA CALCULADOS del score de una empresa -- no los recalcules, no los
cuestiones, no agregues razones, cifras o suposiciones que no estén en los datos entregados.
Tu única tarea es convertir esos datos en 2-3 oraciones claras y directas, en español, que un
vendedor pueda leer en segundos.
Responde solo con el JSON solicitado, sin texto adicional.`;

export interface ScoreExplanationInput {
  topFitFactors: string[];
  topIntentFactor: string | null;
  dataQualityNote: string;
  garantiaVerificada: boolean;
}

export function buildScoreExplanationUserMessage(input: ScoreExplanationInput): string {
  return `Factores de fit (ya calculados, en orden de peso): ${input.topFitFactors.join("; ")}
Señal de necesidad principal: ${input.topIntentFactor ?? "sin señal fuerte de intención identificada"}
Nota de calidad de datos: ${input.dataQualityNote}
Garantía verificada por un humano: ${input.garantiaVerificada ? "sí" : "no, aún pendiente de confirmar"}

Responde en este formato JSON exacto:
{"explicacion": "Por qué es oportunidad: ... Señal de necesidad: ... Confianza: ..."}`;
}

export interface ScoreExplanationOutput {
  explicacion: string;
}

// ---------------------------------------------------------------------------
// 6. Data Quality Control — flags semánticos (WF9). Modelo de mayor
//    capacidad, bajo volumen (solo corre sobre lo que ya pasó Qualification).
// ---------------------------------------------------------------------------

export const DATA_QUALITY_FLAGS_SYSTEM_PROMPT = `Eres un auditor de calidad de datos.
Revisa el registro de una empresa y señala ÚNICAMENTE contradicciones lógicas claras entre los
campos (ejemplo: la descripción dice que es una empresa de software pero fue clasificada como
transporte).
No inventes contradicciones que no estén claramente presentes en el texto entregado.
Si no encuentras ninguna, responde con una lista vacía.
Responde solo con el JSON solicitado, sin texto adicional.`;

export interface DataQualityFlagsInput {
  resumenRegistro: string;
}

export function buildDataQualityFlagsUserMessage(input: DataQualityFlagsInput): string {
  return `Registro de la empresa: "${input.resumenRegistro}"

Responde en este formato JSON exacto:
{"flags": [{"campo_conflicto": string, "descripcion": string, "severidad": "alta" | "media" | "baja"}]}`;
}

export interface DataQualityFlagsOutput {
  flags: Array<{ campo_conflicto: string; descripcion: string; severidad: "alta" | "media" | "baja" }>;
}
