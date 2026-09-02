-- Finbra Broker Backoffice — esquema Postgres
-- Fuente de verdad para todo lo que el Sheet de Brokers/Historial no puede
-- sostener (pipeline con etapas, pago de comisiones, concursos, CMS de
-- recursos, usuarios internos, audit log). El roster de brokers y el
-- histórico de colocación fondeada SIGUEN viviendo en el Google Sheet vía
-- n8n — no se duplican aquí.

CREATE TABLE IF NOT EXISTS admin_users (
  id SERIAL PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  nombre TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('super_admin', 'comercial', 'finanzas')),
  activo BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS audit_log (
  id SERIAL PRIMARY KEY,
  actor_email TEXT NOT NULL,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Overlay de estatus sobre el roster de brokers del Sheet. No se aplica
-- todavía en el login (broker-portal-request-code) -- ver Fase 2 del plan.
CREATE TABLE IF NOT EXISTS broker_status (
  broker_id TEXT PRIMARY KEY,
  estatus TEXT NOT NULL DEFAULT 'activo' CHECK (estatus IN ('activo', 'suspendido')),
  updated_by TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Pipeline de solicitudes en proceso (antes de fondearse). Las mismas 7
-- etapas que ya usa components/ui/StatusPill.tsx en el portal.
CREATE TABLE IF NOT EXISTS operations (
  id SERIAL PRIMARY KEY,
  broker_id TEXT NOT NULL,
  cliente_referencia TEXT NOT NULL,
  monto_solicitado NUMERIC(14, 2) NOT NULL,
  etapa TEXT NOT NULL DEFAULT 'recibida' CHECK (
    etapa IN ('recibida', 'documentacion_pendiente', 'en_analisis', 'aprobada', 'formalizacion', 'fondeada', 'rechazada')
  ),
  notas TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Estatus de PAGO de la comisión ya calculada por lib/commissions.ts.
-- Nunca sobrescribe el cálculo -- solo registra el ciclo de pago.
CREATE TABLE IF NOT EXISTS commission_payments (
  id SERIAL PRIMARY KEY,
  broker_id TEXT NOT NULL,
  operacion_fecha TEXT NOT NULL,
  operacion_monto NUMERIC(14, 2) NOT NULL,
  monto_comision NUMERIC(14, 2) NOT NULL,
  estatus TEXT NOT NULL DEFAULT 'generada' CHECK (estatus IN ('generada', 'aprobada', 'pagada')),
  fecha_pago TIMESTAMPTZ,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (broker_id, operacion_fecha)
);

CREATE TABLE IF NOT EXISTS contests (
  id SERIAL PRIMARY KEY,
  nombre TEXT NOT NULL,
  descripcion TEXT,
  fecha_inicio DATE NOT NULL,
  fecha_fin DATE NOT NULL,
  criterio TEXT NOT NULL CHECK (criterio IN ('monto', 'operaciones')),
  meta_objetivo NUMERIC(14, 2),
  premio TEXT NOT NULL,
  num_ganadores INTEGER NOT NULL DEFAULT 1,
  estatus TEXT NOT NULL DEFAULT 'borrador' CHECK (estatus IN ('borrador', 'activo', 'pausado', 'finalizado')),
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS contest_exclusions (
  contest_id INTEGER NOT NULL REFERENCES contests(id) ON DELETE CASCADE,
  broker_id TEXT NOT NULL,
  PRIMARY KEY (contest_id, broker_id)
);

CREATE TABLE IF NOT EXISTS resources (
  id SERIAL PRIMARY KEY,
  titulo TEXT NOT NULL,
  tipo TEXT NOT NULL,
  categoria TEXT NOT NULL,
  contenido TEXT,
  url TEXT,
  estatus TEXT NOT NULL DEFAULT 'borrador' CHECK (estatus IN ('borrador', 'publicado')),
  orden INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Schema listo para Fase 2 (sin UI de administración ni consumo todavía).
CREATE TABLE IF NOT EXISTS announcements (
  id SERIAL PRIMARY KEY,
  titulo TEXT NOT NULL,
  mensaje TEXT NOT NULL,
  cta_texto TEXT,
  cta_url TEXT,
  audiencia JSONB NOT NULL DEFAULT '{"tipo": "todos"}',
  fecha_publicacion TIMESTAMPTZ NOT NULL DEFAULT now(),
  fecha_expiracion TIMESTAMPTZ,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_operations_broker ON operations(broker_id);
CREATE INDEX IF NOT EXISTS idx_operations_etapa ON operations(etapa);
CREATE INDEX IF NOT EXISTS idx_commission_payments_broker ON commission_payments(broker_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_created_at ON audit_log(created_at DESC);
