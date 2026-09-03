-- Motor de prospección B2B — esquema Postgres
-- Vive en la misma base de datos que schema.sql (tablas prefijadas con lead_)
-- en vez de un schema Postgres separado, para mantener el mismo patrón de
-- acceso vía `sql` de lib/db.ts. No comparte tablas con el portal de aliados.

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Secretos de API que n8n Starter no puede guardar como Variable de instancia
-- (esa función es de plan Pro). Mismo nivel de seguridad que una Variable de
-- n8n -- texto plano, accesible a quien tenga acceso a la base o al workflow.
-- No usar para credenciales de pago ni contraseñas, solo tokens de API de
-- fuentes de datos públicas (DENUE, etc.).
CREATE TABLE IF NOT EXISTS lead_api_secrets (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Config por industria: SCIAN, keywords, fuentes, umbrales ICP, pesos de
-- scoring, jerarquía de buyer persona, preguntas cerradas de enrichment.
-- Vive en config JSONB para no requerir migración cada vez que se ajusta
-- un umbral o se agrega una industria.
CREATE TABLE IF NOT EXISTS lead_vertical_packs (
  id TEXT PRIMARY KEY,
  nombre TEXT NOT NULL,
  descripcion TEXT,
  scian_codes TEXT[] NOT NULL DEFAULT '{}',
  keywords TEXT[] NOT NULL DEFAULT '{}',
  config JSONB NOT NULL DEFAULT '{}',
  activo BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Una fila por ejecución del Orchestrator (por vertical_pack).
CREATE TABLE IF NOT EXISTS lead_run_log (
  id SERIAL PRIMARY KEY,
  vertical_pack_id TEXT REFERENCES lead_vertical_packs(id),
  status TEXT NOT NULL DEFAULT 'iniciado' CHECK (status IN ('iniciado', 'completado', 'error')),
  candidatos_descubiertos INTEGER NOT NULL DEFAULT 0,
  duplicados_evitados INTEGER NOT NULL DEFAULT 0,
  empresas_enriquecidas INTEGER NOT NULL DEFAULT 0,
  empresas_calificadas INTEGER NOT NULL DEFAULT 0,
  hot_generados INTEGER NOT NULL DEFAULT 0,
  costo_ia_usd NUMERIC(10, 4) NOT NULL DEFAULT 0,
  costo_apis_usd NUMERIC(10, 4) NOT NULL DEFAULT 0,
  errores INTEGER NOT NULL DEFAULT 0,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ
);

-- Landing zone de WF1 Discovery: candidatos tal cual vienen de la fuente,
-- antes de Normalization/Deduplication. procesado=false hasta que WF2 los
-- consume y crea o actualiza el lead_company correspondiente.
CREATE TABLE IF NOT EXISTS lead_raw_candidates (
  id SERIAL PRIMARY KEY,
  run_id INTEGER REFERENCES lead_run_log(id),
  vertical_pack_id TEXT REFERENCES lead_vertical_packs(id),
  source_type TEXT NOT NULL CHECK (source_type IN ('denue', 'google_maps', 'serper_search')),
  nombre_crudo TEXT,
  raw_payload JSONB NOT NULL,
  procesado BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_lead_raw_candidates_pendientes ON lead_raw_candidates(vertical_pack_id) WHERE procesado = false;

-- Registro maestro de empresas. Nunca se borra: discarded se queda con
-- discard_reason para poder reprocesarse si aparece señal nueva.
CREATE TABLE IF NOT EXISTS lead_companies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre_comercial TEXT NOT NULL,
  razon_social TEXT,
  domain TEXT,
  scian_code TEXT,
  industria TEXT,
  subindustria TEXT,
  vertical_pack_id TEXT REFERENCES lead_vertical_packs(id),
  descripcion TEXT,
  website_url TEXT,
  estado TEXT,
  municipio TEXT,
  direccion TEXT,
  lat NUMERIC(9, 6),
  lng NUMERIC(9, 6),
  telefono_principal TEXT,
  correo_corporativo TEXT,
  linkedin_url TEXT,

  empleados_estimado INTEGER,
  empleados_confidence NUMERIC(3, 2),
  empleados_estimated BOOLEAN NOT NULL DEFAULT true,

  ventas_estimado_mxn NUMERIC(14, 2),
  ventas_confidence NUMERIC(3, 2),
  ventas_estimated BOOLEAN NOT NULL DEFAULT true,

  antiguedad_anios_estimado NUMERIC(4, 1),
  antiguedad_confidence NUMERIC(3, 2),

  ciclo_cobranza_dias_estimado INTEGER,
  cliente_b2b_confirmado BOOLEAN NOT NULL DEFAULT false,

  -- Hard gate de garantía (Etapa 4): el hecho y la confianza en el hecho
  -- son campos separados a propósito -- garantia_verificado=false es lo
  -- que fuerza HITL aunque tiene_garantia_* sea true.
  tiene_garantia_vehicular BOOLEAN NOT NULL DEFAULT false,
  tiene_garantia_inmobiliaria BOOLEAN NOT NULL DEFAULT false,
  garantia_confidence NUMERIC(3, 2),
  garantia_verificado BOOLEAN NOT NULL DEFAULT false,

  fit_score NUMERIC(5, 2),
  intent_score NUMERIC(5, 2),
  data_quality_score NUMERIC(5, 2),
  total_score NUMERIC(5, 2),
  categoria TEXT CHECK (categoria IN ('hot', 'warm', 'qualified', 'discarded')),
  score_explicacion TEXT,

  estatus_comercial TEXT NOT NULL DEFAULT 'nuevo' CHECK (
    estatus_comercial IN (
      'nuevo', 'en_revision_hitl', 'contactado', 'reunion_agendada',
      'oportunidad', 'rechazado', 'cliente', 'descartado'
    )
  ),
  discard_reason TEXT,

  -- Nombre normalizado (sin SA de CV, minúsculas, sin acentos) usado por
  -- el matching trigram de Deduplication.
  dedupe_match_key TEXT,

  fecha_descubrimiento TIMESTAMPTZ NOT NULL DEFAULT now(),
  fecha_ultima_actualizacion TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_processed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS lead_contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES lead_companies(id) ON DELETE CASCADE,
  nombre TEXT,
  cargo TEXT,
  email TEXT,
  telefono TEXT,
  linkedin_url TEXT,
  fuente TEXT,
  confidence NUMERIC(3, 2),
  es_decisor_principal BOOLEAN NOT NULL DEFAULT false,
  estatus TEXT NOT NULL DEFAULT 'activo' CHECK (estatus IN ('activo', 'desactualizado')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Log de evidencia append-only: de dónde salió cada dato. raw_payload
-- guarda el snapshot crudo para poder reprocesar sin volver a llamar la fuente.
CREATE TABLE IF NOT EXISTS lead_sources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID REFERENCES lead_companies(id) ON DELETE CASCADE,
  contact_id UUID REFERENCES lead_contacts(id) ON DELETE CASCADE,
  source_type TEXT NOT NULL CHECK (
    source_type IN ('denue', 'google_maps', 'sitio_web', 'google_search', 'proveedor_enriquecimiento', 'ia_inferido')
  ),
  source_ref TEXT,
  raw_payload JSONB,
  confidence_default NUMERIC(3, 2),
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Señales comerciales/de crecimiento detectadas, alimentan Intent Score.
-- weight_applied queda registrado para el feedback loop (qué señales
-- predijeron mejor la conversión real).
CREATE TABLE IF NOT EXISTS lead_signals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES lead_companies(id) ON DELETE CASCADE,
  signal_type TEXT NOT NULL,
  description TEXT,
  source_id UUID REFERENCES lead_sources(id),
  confidence NUMERIC(3, 2),
  weight_applied NUMERIC(5, 2),
  detected_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Historial versionado de scores. lead_companies guarda el score ACTUAL;
-- esta tabla existe para poder comparar cohortes antes/después de
-- recalibrar pesos sin perder el histórico.
CREATE TABLE IF NOT EXISTS lead_scores (
  id SERIAL PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES lead_companies(id) ON DELETE CASCADE,
  fit_score NUMERIC(5, 2),
  intent_score NUMERIC(5, 2),
  data_quality_score NUMERIC(5, 2),
  total_score NUMERIC(5, 2),
  categoria TEXT,
  run_id INTEGER REFERENCES lead_run_log(id),
  score_version TEXT NOT NULL DEFAULT 'v1',
  computed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Timeline de todo lo que pasa con una empresa: acciones del pipeline
-- (descubierto, enriquecido, sincronizado...) y acciones de ventas
-- (contactado, reunión, oportunidad, cliente...). Es la fuente de verdad
-- para las métricas de conversión y el feedback loop.
CREATE TABLE IF NOT EXISTS lead_prospecting_activity (
  id SERIAL PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES lead_companies(id) ON DELETE CASCADE,
  activity_type TEXT NOT NULL,
  actor TEXT NOT NULL,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Cola de revisión humana (dedup ambiguo, garantía no verificada, DQ en
-- zona gris). Separada de prospecting_activity porque necesita estado
-- propio (pendiente/resuelto) para el panel de revisión.
CREATE TABLE IF NOT EXISTS lead_hitl_review (
  id SERIAL PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES lead_companies(id) ON DELETE CASCADE,
  reason TEXT NOT NULL,
  assigned_to TEXT,
  status TEXT NOT NULL DEFAULT 'pendiente' CHECK (status IN ('pendiente', 'resuelto')),
  resolution_notes TEXT,
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Dedup: dominio es la clave más fuerte, único cuando existe.
CREATE UNIQUE INDEX IF NOT EXISTS idx_lead_companies_domain ON lead_companies(domain) WHERE domain IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_lead_companies_telefono ON lead_companies(telefono_principal) WHERE telefono_principal IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_lead_companies_dedupe_trgm ON lead_companies USING gin (dedupe_match_key gin_trgm_ops);

-- Consultas del backoffice (panel de ventas).
CREATE INDEX IF NOT EXISTS idx_lead_companies_categoria ON lead_companies(categoria);
CREATE INDEX IF NOT EXISTS idx_lead_companies_estatus ON lead_companies(estatus_comercial);
CREATE INDEX IF NOT EXISTS idx_lead_companies_vertical ON lead_companies(vertical_pack_id);
CREATE INDEX IF NOT EXISTS idx_lead_companies_last_processed ON lead_companies(last_processed_at);

CREATE INDEX IF NOT EXISTS idx_lead_contacts_company ON lead_contacts(company_id);
CREATE INDEX IF NOT EXISTS idx_lead_sources_company ON lead_sources(company_id);
CREATE INDEX IF NOT EXISTS idx_lead_signals_company ON lead_signals(company_id);
CREATE INDEX IF NOT EXISTS idx_lead_scores_company ON lead_scores(company_id);
CREATE INDEX IF NOT EXISTS idx_lead_prospecting_activity_company ON lead_prospecting_activity(company_id);
CREATE INDEX IF NOT EXISTS idx_lead_prospecting_activity_created_at ON lead_prospecting_activity(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_lead_hitl_review_status ON lead_hitl_review(status);

-- Feedback Loop (Etapa 6): snapshots semanales de qué tan bien predicen los
-- componentes de score la conversión real observada en lead_prospecting_activity.
-- Son SUGERENCIAS, no cambios: ningún proceso automático debe modificar
-- lead_vertical_packs.config ni las fórmulas de scoring a partir de esta tabla
-- sin revisión humana explícita (reviewed=true).
CREATE TABLE IF NOT EXISTS lead_calibration_suggestions (
  id SERIAL PRIMARY KEY,
  vertical_pack_id TEXT REFERENCES lead_vertical_packs(id),
  analysis_date DATE NOT NULL DEFAULT CURRENT_DATE,
  sample_size INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'ok' CHECK (status IN ('ok', 'datos_insuficientes')),
  findings JSONB NOT NULL,
  reviewed BOOLEAN NOT NULL DEFAULT false,
  reviewed_by TEXT,
  reviewed_at TIMESTAMPTZ,
  resolution_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_lead_calibration_suggestions_reviewed ON lead_calibration_suggestions(reviewed, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_lead_calibration_suggestions_vertical ON lead_calibration_suggestions(vertical_pack_id);

-- Control de cuota y visibilidad de costo (Etapa 7): un registro por llamada a una
-- fuente externa de pago o con cuota limitada. SerpApi (plan gratuito = 100
-- busquedas/mes) es la unica con un limite duro que de verdad se puede romper,
-- por eso es la unica con gate en Discovery -- Anthropic se registra solo para
-- visibilidad de volumen (el costo real en dolares se revisa en la consola de
-- Anthropic, aqui no se inventa una cifra que el workflow no puede calcular).
CREATE TABLE IF NOT EXISTS lead_api_usage (
  id SERIAL PRIMARY KEY,
  source TEXT NOT NULL CHECK (source IN ('serpapi', 'anthropic')),
  outcome TEXT NOT NULL CHECK (outcome IN ('exitoso', 'omitido_por_cuota', 'error')),
  vertical_pack_id TEXT REFERENCES lead_vertical_packs(id),
  metadata JSONB,
  called_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_lead_api_usage_source_date ON lead_api_usage(source, called_at);
