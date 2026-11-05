-- Clientes 360 — base del módulo de clientes y del futuro CRM (tablas crm_*).
--
-- Principios:
-- - La EMPRESA es el centro: una por razón social. Es prospecto o cliente
--   según lo que tenga ligado, no por un campo que alguien captura.
-- - SIAC sigue siendo la fuente de saldos, pagos y créditos. Nada de aquí
--   escribe en col_clients, col_credits, fotos ni pagos, salvo el vínculo
--   col_clients.empresa_id, que la sincronización nunca pisa (solo actualiza
--   nombre y domicilios).
-- - Cada cliente nuevo de SIAC recibe su empresa en la misma transacción de la
--   foto diaria (lib/db/empresas.ts: vincularEmpresasNuevas).
-- - `ambiente` igual que en col_*: los datos de la copia de pruebas de SIAC no se
--   mezclan con los reales y se pueden purgar completos.
-- - Las actividades comerciales solo se escriben, nunca se editan ni se borran,
--   igual que col_activities.
--
-- Correr después de collections-schema.sql (usa col_clients y col_contacts) y
-- antes de security.sql. Se puede correr varias veces sin romper nada.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Configuración del módulo que cambia sin desplegar código. Cada cambio se
-- registra en audit_log.
CREATE TABLE IF NOT EXISTS crm_settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  descripcion TEXT,
  updated_by TEXT NOT NULL DEFAULT 'sistema',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO crm_settings (key, value, descripcion) VALUES
  ('ejecutivo_por_omision', '{"email": null}', 'Correo del usuario del backoffice (admin_users) que queda como ejecutivo de cada empresa nueva. null = sin asignar.')
ON CONFLICT (key) DO NOTHING;

-- Empresa: una por razón social.
CREATE TABLE IF NOT EXISTS crm_empresas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ambiente TEXT NOT NULL CHECK (ambiente IN ('pruebas', 'produccion')),
  -- Cómo la llama el equipo. Al nacer de SIAC es el nombre del listado.
  nombre TEXT NOT NULL CHECK (length(trim(nombre)) > 0),
  razon_social TEXT,
  -- Persona moral: 3 letras + fecha + homoclave; persona física: 4 letras.
  rfc TEXT CHECK (rfc ~ '^[A-ZÑ&]{3,4}[0-9]{6}[A-Z0-9]{3}$'),
  nombre_comercial TEXT,
  industria TEXT,
  scian_code TEXT,
  sitio_web TEXT,
  -- Responsable de la relación. NULL = sin asignar.
  ejecutivo_email TEXT REFERENCES admin_users(email) ON UPDATE CASCADE,
  -- De dónde salió el registro. Los demás orígenes llegan con el CRM.
  origen TEXT NOT NULL CHECK (origen IN ('siac', 'manual', 'hubspot')),
  -- Cliente de SIAC con el que nació (origen = 'siac'). Es la llave para que
  -- vincular sea idempotente: un cliente nunca genera dos empresas.
  creada_desde_cliente UUID UNIQUE REFERENCES col_clients(id) ON DELETE SET NULL,
  notas TEXT,
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (ambiente, rfc)
);

CREATE INDEX IF NOT EXISTS idx_crm_empresas_ejecutivo ON crm_empresas(ejecutivo_email);

-- 2026-11-05: empresas que llegan del historial de HubSpot (clientes que ya
-- liquidaron antes de la sincronización con SIAC). Bases creadas antes: su
-- CHECK de origen no incluía 'hubspot'.
ALTER TABLE crm_empresas DROP CONSTRAINT IF EXISTS crm_empresas_origen_check;
ALTER TABLE crm_empresas ADD CONSTRAINT crm_empresas_origen_check CHECK (origen IN ('siac', 'manual', 'hubspot'));
-- ID de la empresa en HubSpot, para que volver a importar no la duplique.
ALTER TABLE crm_empresas ADD COLUMN IF NOT EXISTS hubspot_company_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_crm_empresas_hubspot ON crm_empresas(ambiente, hubspot_company_id) WHERE hubspot_company_id IS NOT NULL;

-- Vínculo del cliente de SIAC con su empresa. NO ACTION al borrar: una empresa
-- con clientes ligados no se puede borrar por accidente.
ALTER TABLE col_clients ADD COLUMN IF NOT EXISTS empresa_id UUID REFERENCES crm_empresas(id);
CREATE INDEX IF NOT EXISTS idx_col_clients_empresa ON col_clients(empresa_id);

-- Personas de contacto de la empresa. Los teléfonos y correos siguen en
-- col_contacts (los usan los envíos de WhatsApp); aquí se agrupan por persona.
CREATE TABLE IF NOT EXISTS crm_personas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id UUID NOT NULL REFERENCES crm_empresas(id) ON DELETE CASCADE,
  nombre TEXT NOT NULL CHECK (length(trim(nombre)) > 0),
  puesto TEXT,
  -- Papel en la decisión de financiamiento: decide, influye (evalúa o
  -- recomienda) u opera (paga, entrega documentos). NULL = sin clasificar.
  rol_decision TEXT CHECK (rol_decision IN ('decide', 'influye', 'opera')),
  es_representante_legal BOOLEAN NOT NULL DEFAULT false,
  canal_preferido TEXT CHECK (canal_preferido IN ('whatsapp', 'llamada', 'correo')),
  horario_preferido TEXT,
  es_principal BOOLEAN NOT NULL DEFAULT false,
  -- false = ya no está en la empresa o ya no es el contacto. Se conserva para el historial.
  vigente BOOLEAN NOT NULL DEFAULT true,
  notas TEXT,
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_crm_personas_empresa ON crm_personas(empresa_id);
-- Un solo contacto principal vigente por empresa.
CREATE UNIQUE INDEX IF NOT EXISTS idx_crm_personas_principal ON crm_personas(empresa_id) WHERE es_principal AND vigente;

ALTER TABLE col_contacts ADD COLUMN IF NOT EXISTS persona_id UUID REFERENCES crm_personas(id) ON DELETE SET NULL;

-- Actividad comercial y de seguimiento (la de cobranza sigue en col_activities).
-- Solo se escribe.
CREATE TABLE IF NOT EXISTS crm_actividades (
  id BIGSERIAL PRIMARY KEY,
  empresa_id UUID NOT NULL REFERENCES crm_empresas(id) ON DELETE CASCADE,
  persona_id UUID REFERENCES crm_personas(id) ON DELETE SET NULL,
  tipo TEXT NOT NULL CHECK (tipo IN ('llamada', 'reunion', 'correo', 'whatsapp', 'visita', 'nota')),
  resultado TEXT CHECK (resultado IN ('contesto', 'no_contesto', 'interesado', 'no_interesado', 'seguimiento', 'otro')),
  descripcion TEXT,
  -- Correo del usuario del backoffice, o 'sistema'.
  actor TEXT NOT NULL,
  -- Cuándo pasó; created_at es cuándo se registró.
  ocurrido_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_crm_actividades_empresa ON crm_actividades(empresa_id, ocurrido_at DESC);
CREATE INDEX IF NOT EXISTS idx_crm_actividades_actor ON crm_actividades(actor, ocurrido_at DESC);

-- Tareas del equipo: manuales o creadas por reglas (playbooks, oportunidades).
CREATE TABLE IF NOT EXISTS crm_tareas (
  id BIGSERIAL PRIMARY KEY,
  empresa_id UUID NOT NULL REFERENCES crm_empresas(id) ON DELETE CASCADE,
  credit_id UUID REFERENCES col_credits(id) ON DELETE SET NULL,
  titulo TEXT NOT NULL CHECK (length(trim(titulo)) > 0),
  descripcion TEXT,
  tipo TEXT NOT NULL DEFAULT 'seguimiento' CHECK (tipo IN ('llamada', 'seguimiento', 'revision', 'incidencia', 'dato_faltante', 'otro')),
  vence_el DATE NOT NULL,
  responsable_email TEXT REFERENCES admin_users(email) ON UPDATE CASCADE,
  estado TEXT NOT NULL DEFAULT 'abierta' CHECK (estado IN ('abierta', 'hecha', 'cancelada')),
  -- 'manual', o la regla que la creó ('playbook:<clave>', 'oportunidad:<id>').
  origen TEXT NOT NULL DEFAULT 'manual',
  -- Evita que una regla abra la misma tarea dos veces mientras siga abierta
  -- (índice único parcial de abajo). NULL en las manuales.
  dedupe_key TEXT,
  resultado TEXT,
  cerrada_por TEXT,
  cerrada_at TIMESTAMPTZ,
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_crm_tareas_dedupe ON crm_tareas(dedupe_key) WHERE estado = 'abierta' AND dedupe_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_crm_tareas_pendientes ON crm_tareas(responsable_email, vence_el) WHERE estado = 'abierta';
CREATE INDEX IF NOT EXISTS idx_crm_tareas_empresa ON crm_tareas(empresa_id);

-- Negocios comerciales de la empresa. Por ahora solo los ganados que se
-- importan de HubSpot (2026-11-05), para conocer la historia de clientes que ya
-- liquidaron antes de la sincronización con SIAC. Es la tabla del futuro
-- pipeline del CRM. El monto es el del negocio en HubSpot, no lo dispuesto:
-- la fuente oficial de lo prestado sigue siendo SIAC.
CREATE TABLE IF NOT EXISTS crm_negocios (
  id BIGSERIAL PRIMARY KEY,
  empresa_id UUID NOT NULL REFERENCES crm_empresas(id) ON DELETE CASCADE,
  origen TEXT NOT NULL CHECK (origen IN ('hubspot')),
  -- Llave de HubSpot: volver a importar actualiza en vez de duplicar.
  hubspot_deal_id TEXT UNIQUE,
  nombre TEXT NOT NULL,
  pipeline TEXT NOT NULL CHECK (pipeline IN ('nuevo', 'renovacion')),
  -- Etapa tal como venía de HubSpot ("Contrato Ganado", "Contrato ganado Leasing"…).
  etapa TEXT,
  producto TEXT,
  monto NUMERIC(14, 2),
  fecha_cierre DATE,
  ganado BOOLEAN NOT NULL DEFAULT true,
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_crm_negocios_empresa ON crm_negocios(empresa_id, fecha_cierre DESC);

-- Una empresa por cada cliente de SIAC que todavía no tiene. Misma consulta que
-- vincularEmpresasNuevas (lib/db/empresas.ts), para todos los ambientes.
INSERT INTO crm_empresas (ambiente, nombre, razon_social, origen, creada_desde_cliente, ejecutivo_email, created_by)
SELECT c.ambiente, c.nombre, c.nombre, 'siac', c.id,
       (SELECT a.email FROM crm_settings s JOIN admin_users a ON a.email = s.value->>'email' AND a.activo WHERE s.key = 'ejecutivo_por_omision'),
       'sistema'
FROM col_clients c
WHERE c.empresa_id IS NULL
ON CONFLICT (creada_desde_cliente) DO NOTHING;

UPDATE col_clients c SET empresa_id = e.id
FROM crm_empresas e
WHERE e.creada_desde_cliente = c.id AND c.empresa_id IS NULL;

-- Datos de empresas y personas: RLS activo sin políticas, para que la API REST
-- de Supabase no los exponga. La app entra como postgres (BYPASSRLS). Los
-- permisos de anon y authenticated los quita security.sql, que se corre al
-- final de cada tanda.
ALTER TABLE crm_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_empresas ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_personas ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_actividades ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_tareas ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_negocios ENABLE ROW LEVEL SECURITY;
