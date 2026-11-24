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
  origen TEXT NOT NULL CHECK (origen IN ('siac', 'manual')),
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
CREATE INDEX IF NOT EXISTS idx_crm_tareas_dedupe_todas ON crm_tareas(dedupe_key) WHERE dedupe_key IS NOT NULL;

-- Radar de renovación (agregado el 2026-11-05). Lo corre el cron después de la
-- foto diaria (lib/db/renovaciones.ts); las reglas están en lib/clientes/renovaciones.ts.
INSERT INTO crm_settings (key, value, descripcion) VALUES
  ('renovaciones',
   '{"activo": true, "ventanas": [90, 60, 30], "atraso_maximo_historico": 15, "veces_mora_max": 2}',
   'Radar de renovación. activo: prende o apaga el radar automático. ventanas: días antes del fin del plazo en que se abre la oportunidad (la mayor) y se recuerda (las demás). atraso_maximo_historico y veces_mora_max: compuertas de comportamiento de pago para calificar.')
ON CONFLICT (key) DO NOTHING;

-- Playbooks de seguimiento (agregado el 2026-11-09). Los corre el cron después
-- de la foto diaria (lib/db/playbooks.ts); las reglas están en lib/clientes/playbooks.ts.
INSERT INTO crm_settings (key, value, descripcion) VALUES
  ('playbooks',
   '{"activo": true, "bienvenida": true, "primer_pago_dias": 5, "revision_dias": 90, "revision_max_por_dia": 5, "liquidacion": true, "rescate": true}',
   'Tareas automáticas. activo: prende o apaga todos. bienvenida: llamada, cuenta de pago y contacto de pagos cuando aparece un crédito nuevo. primer_pago_dias: días antes del primer vencimiento para confirmar la CLABE (0 = apagado). revision_dias: días sin contacto del equipo para pedir una llamada de revisión (0 = apagado). revision_max_por_dia: tope de revisiones nuevas por día. liquidacion: tarea cuando un crédito sale del listado. rescate: llamada de rescate cuando la salud del cliente pasa a En riesgo.')
ON CONFLICT (key) DO NOTHING;

-- Oportunidad comercial. Solo autoriza a contactar al cliente: NO es una
-- aprobación de crédito, y el monto de referencia no es una oferta.
CREATE TABLE IF NOT EXISTS crm_oportunidades (
  id BIGSERIAL PRIMARY KEY,
  empresa_id UUID NOT NULL REFERENCES crm_empresas(id) ON DELETE CASCADE,
  -- Crédito que la originó (el que está por terminar).
  credit_id UUID REFERENCES col_credits(id) ON DELETE SET NULL,
  -- Incremento y reactivación llegan después.
  tipo TEXT NOT NULL DEFAULT 'renovacion' CHECK (tipo IN ('renovacion')),
  -- abierta: nadie la ha trabajado; en_contacto e interesado: la trabaja el
  -- ejecutivo; ganada: pasó a análisis de crédito; descartada: la cerró una
  -- persona con un motivo; cerrada: la cerró el radar (cayó en mora o el
  -- crédito salió del listado).
  estado TEXT NOT NULL DEFAULT 'abierta' CHECK (estado IN ('abierta', 'en_contacto', 'interesado', 'ganada', 'descartada', 'cerrada')),
  origen TEXT NOT NULL DEFAULT 'radar' CHECK (origen IN ('radar')),
  fecha_termino DATE,
  -- Monto original del crédito que termina. Referencia preliminar, no oferta.
  monto_referencia NUMERIC(14, 2),
  -- Foto de SIAC con la que se calculó.
  fecha_corte DATE NOT NULL,
  -- Por qué califica, en texto, para mostrarlo tal cual.
  razones JSONB NOT NULL DEFAULT '[]',
  responsable_email TEXT REFERENCES admin_users(email) ON UPDATE CASCADE,
  motivo_cierre TEXT,
  cerrada_por TEXT,
  cerrada_at TIMESTAMPTZ,
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Una abierta por empresa y tipo, y el radar abre a lo más una por crédito
-- (si se descarta o se cierra, ese crédito ya no vuelve a generar otra).
CREATE UNIQUE INDEX IF NOT EXISTS idx_crm_oportunidades_abierta ON crm_oportunidades(empresa_id, tipo) WHERE estado IN ('abierta', 'en_contacto', 'interesado');
CREATE UNIQUE INDEX IF NOT EXISTS idx_crm_oportunidades_credito ON crm_oportunidades(credit_id, tipo) WHERE origen = 'radar';
CREATE INDEX IF NOT EXISTS idx_crm_oportunidades_empresa ON crm_oportunidades(empresa_id);

-- Salud del cliente de cada día (lib/clientes/salud.ts), guardada después de la
-- foto diaria. Sirve para ver la tendencia y para el playbook «pasó a En riesgo»,
-- que compara contra el día guardado anterior. Una fila por empresa y día; si el
-- cron corre dos veces, la segunda reemplaza a la primera.
CREATE TABLE IF NOT EXISTS crm_salud_diaria (
  empresa_id UUID NOT NULL REFERENCES crm_empresas(id) ON DELETE CASCADE,
  fecha DATE NOT NULL,
  puntos INTEGER NOT NULL CHECK (puntos BETWEEN 0 AND 100),
  nivel TEXT NOT NULL CHECK (nivel IN ('sana', 'atencion', 'riesgo')),
  -- [{texto, puntos}] de lo que le restó, de mayor a menor.
  razones JSONB NOT NULL DEFAULT '[]',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (empresa_id, fecha)
);
CREATE INDEX IF NOT EXISTS idx_crm_salud_diaria_fecha ON crm_salud_diaria(fecha);

-- Playbook nuevo «rescate» (pasó a En riesgo): prendido en la fila que ya existe.
UPDATE crm_settings
SET value = value || '{"rescate": true}',
    descripcion = descripcion || ' rescate: llamada de rescate cuando la salud del cliente pasa a En riesgo.'
WHERE key = 'playbooks' AND NOT (value ? 'rescate');

-- ---------------------------------------------------------------- originación
-- Teléfonos y correos de las personas de empresas que todavía no son clientes
-- de SIAC (prospectos). Los de clientes siguen en col_contacts, en su
-- expediente de cobranza; estos nunca reciben recordatorios.
CREATE TABLE IF NOT EXISTS crm_persona_canales (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  persona_id UUID NOT NULL REFERENCES crm_personas(id) ON DELETE CASCADE,
  tipo TEXT NOT NULL CHECK (tipo IN ('telefono', 'email')),
  valor TEXT NOT NULL CHECK (length(trim(valor)) > 0),
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (persona_id, tipo, valor)
);

-- Negocio de crédito: una solicitud de una empresa, desde el primer contacto
-- hasta que el crédito está dispersado en SIAC (lib/clientes/negocios.ts).
-- Reemplaza al pipeline de negocios de HubSpot. Etapas 1 a 9 en orden, más dos
-- cierres: pospuesto (volver a buscarlo después) y rechazado.
CREATE TABLE IF NOT EXISTS crm_negocios_credito (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ambiente TEXT NOT NULL CHECK (ambiente IN ('pruebas', 'produccion')),
  empresa_id UUID NOT NULL REFERENCES crm_empresas(id) ON DELETE RESTRICT,
  -- nuevo: primer crédito; renovacion: al terminar uno; incremento: más monto con uno vigente.
  tipo TEXT NOT NULL DEFAULT 'nuevo' CHECK (tipo IN ('nuevo', 'renovacion', 'incremento')),
  origen TEXT NOT NULL CHECK (origen IN ('leads', 'credit_health', 'broker', 'renovacion', 'web', 'marketing', 'outbound', 'referido', 'pymio', 'manual')),
  etapa TEXT NOT NULL DEFAULT 'prospecto' CHECK (etapa IN (
    'prospecto', 'calificado', 'solicitud', 'analisis', 'oferta', 'expediente', 'comite', 'formalizacion', 'dispersado',
    'pospuesto', 'rechazado'
  )),
  -- Desde cuándo está en su etapa actual (para medir días en etapa).
  etapa_desde TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Monto que se platica: no es una oferta ni una aprobación.
  monto_estimado NUMERIC(14, 2) CHECK (monto_estimado > 0),
  responsable_email TEXT REFERENCES admin_users(email) ON UPDATE CASCADE,
  -- Por qué se pospuso o se rechazó (el catálogo de motivos llega en la fase O2).
  motivo_cierre TEXT,
  notas TEXT,
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Fase O2: la solicitud (lib/clientes/negocios.ts valida los valores) y los cierres.
ALTER TABLE crm_negocios_credito ADD COLUMN IF NOT EXISTS producto TEXT CHECK (producto IN ('pyme', 'simple', 'arrendamiento'));
ALTER TABLE crm_negocios_credito ADD COLUMN IF NOT EXISTS plazo_meses INTEGER CHECK (plazo_meses BETWEEN 1 AND 120);
ALTER TABLE crm_negocios_credito ADD COLUMN IF NOT EXISTS destino TEXT CHECK (destino IN ('capital_trabajo', 'compra_activo', 'refinanciamiento', 'expansion', 'otro'));
ALTER TABLE crm_negocios_credito ADD COLUMN IF NOT EXISTS destino_detalle TEXT;
ALTER TABLE crm_negocios_credito ADD COLUMN IF NOT EXISTS garantia_tipo TEXT CHECK (garantia_tipo IN ('vehicular', 'inmobiliaria', 'otra', 'sin_garantia'));
ALTER TABLE crm_negocios_credito ADD COLUMN IF NOT EXISTS garantia_detalle TEXT;
ALTER TABLE crm_negocios_credito ADD COLUMN IF NOT EXISTS garantia_valor NUMERIC(14, 2) CHECK (garantia_valor > 0);
-- Pospuesto: cuándo volver a contactarlo (crea una tarea para esa fecha).
ALTER TABLE crm_negocios_credito ADD COLUMN IF NOT EXISTS recontactar_el DATE;
-- Rechazado: motivo del catálogo y quién cerró (Finbra o el cliente).
ALTER TABLE crm_negocios_credito ADD COLUMN IF NOT EXISTS rechazo_motivo TEXT;
ALTER TABLE crm_negocios_credito ADD COLUMN IF NOT EXISTS rechazo_por TEXT CHECK (rechazo_por IN ('finbra', 'cliente'));

-- Fase O3: de qué lead, prospecto de Credit Health u oportunidad de renovación
-- salió ('lead:<id>', 'credit_health:<id>', 'oportunidad:<id>'). Uno por origen.
ALTER TABLE crm_negocios_credito ADD COLUMN IF NOT EXISTS origen_ref TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_crm_negocios_credito_origen_ref ON crm_negocios_credito(origen_ref) WHERE origen_ref IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_crm_negocios_credito_empresa ON crm_negocios_credito(empresa_id);
CREATE INDEX IF NOT EXISTS idx_crm_negocios_credito_etapa ON crm_negocios_credito(ambiente, etapa);

-- Cada cambio de etapa, con quién y cuándo. La primera fila (de = NULL) es el alta.
CREATE TABLE IF NOT EXISTS crm_negocio_etapas (
  id BIGSERIAL PRIMARY KEY,
  negocio_id UUID NOT NULL REFERENCES crm_negocios_credito(id) ON DELETE CASCADE,
  de TEXT,
  a TEXT NOT NULL,
  motivo TEXT,
  actor TEXT NOT NULL,
  ocurrido_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_crm_negocio_etapas_negocio ON crm_negocio_etapas(negocio_id, ocurrido_at);

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
ALTER TABLE crm_oportunidades ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_salud_diaria ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_persona_canales ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_negocios_credito ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_negocio_etapas ENABLE ROW LEVEL SECURITY;
