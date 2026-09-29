-- Collections OS (cobranza) — esquema Postgres
-- Vive en la misma base que schema.sql y leads-schema.sql, con tablas
-- prefijadas col_, igual que el motor de leads usa lead_.
--
-- Principios:
-- - SIAC es la fuente de verdad financiera. Las tablas col_clients, col_credits
--   y col_balance_snapshots son un REFLEJO que escribe solo la sincronización;
--   la interfaz nunca edita esos campos ni consulta SIAC en vivo.
-- - Lo que genera el equipo (contactos manuales, gestiones, promesas, mensajes)
--   vive en tablas propias, para que una sincronización nunca lo pise.
-- - Todo lo que pasa con un cliente queda en col_activities (el timeline del
--   expediente), que solo se escribe y nunca se edita ni se borra.
-- - La cola de trabajo y los buckets de antigüedad NO son tablas: se calculan
--   con reglas en código a partir de estas tablas, para que cambiar una regla
--   no requiera migración.
--
-- Correr después de schema.sql y leads-schema.sql, y luego volver a correr
-- security.sql (o el bloque de RLS del final de este archivo).

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Una fila por corrida de sincronización con SIAC. `ambiente` existe porque
-- vamos a desarrollar contra la copia de pruebas de SIAC (datos reales de
-- clientes, congelados) antes de tener producción: esos datos no deben
-- mezclarse con la operación real ni con la analítica, y hay que poder
-- purgarlos completos.
CREATE TABLE IF NOT EXISTS col_sync_runs (
  id SERIAL PRIMARY KEY,
  ambiente TEXT NOT NULL CHECK (ambiente IN ('pruebas', 'produccion')),
  -- diaria: la foto del día. reconstruccion: carga histórica con fechas de
  -- corte pasadas. credito: refresco manual de un solo crédito desde el expediente.
  tipo TEXT NOT NULL CHECK (tipo IN ('diaria', 'reconstruccion', 'credito')),
  fecha_corte DATE,
  status TEXT NOT NULL DEFAULT 'iniciado' CHECK (status IN ('iniciado', 'completado', 'parcial', 'error')),
  clientes_leidos INTEGER NOT NULL DEFAULT 0,
  creditos_leidos INTEGER NOT NULL DEFAULT 0,
  snapshots_guardados INTEGER NOT NULL DEFAULT 0,
  llamadas_siac INTEGER NOT NULL DEFAULT 0,
  errores INTEGER NOT NULL DEFAULT 0,
  error_detalle TEXT,
  disparado_por TEXT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ
);

-- Respuesta cruda de cada llamada a SIAC, mismo patrón que lead_sources.raw_payload:
-- permite reprocesar sin volver a llamar a SIAC y auditar qué dijo SIAC en su
-- momento aunque después recalcule la historia (un pago capturado tarde con
-- fecha valor anterior cambia el saldo histórico). `parametros` NUNCA incluye
-- RazonSocial ni ClaveAutenticacion.
CREATE TABLE IF NOT EXISTS col_siac_raw (
  id BIGSERIAL PRIMARY KEY,
  sync_run_id INTEGER REFERENCES col_sync_runs(id) ON DELETE CASCADE,
  operacion TEXT NOT NULL,
  parametros JSONB NOT NULL,
  http_status INTEGER,
  detalle TEXT,
  respuesta JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS col_clients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ambiente TEXT NOT NULL CHECK (ambiente IN ('pruebas', 'produccion')),
  id_cliente_siac TEXT NOT NULL,
  nombre TEXT NOT NULL,
  rfc TEXT,
  -- Pausa manual de la cobranza automática (por ejemplo, negociación en curso
  -- o cliente fallecido). La cola y los recordatorios la respetan.
  pausa_hasta DATE,
  pausa_motivo TEXT,
  raw JSONB NOT NULL,
  primera_vez_visto_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (ambiente, id_cliente_siac)
);

-- Teléfonos y correos del cliente. Separados de col_clients porque el equipo
-- corrige y agrega contactos, y la sincronización no debe pisar esas
-- correcciones: una fila con origen='siac' la actualiza la sincronización;
-- una con origen='manual' solo la toca el equipo.
CREATE TABLE IF NOT EXISTS col_contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES col_clients(id) ON DELETE CASCADE,
  origen TEXT NOT NULL CHECK (origen IN ('siac', 'manual')),
  -- Campo de SIAC del que salió (Celular, NumeroTelefono, Email, Email2).
  -- Sirve de llave para que la sincronización actualice en vez de duplicar.
  campo_siac TEXT,
  tipo TEXT NOT NULL CHECK (tipo IN ('telefono', 'email')),
  valor_original TEXT NOT NULL,
  -- Teléfono normalizado a 52 + 10 dígitos (regla del prototipo de n8n).
  -- NULL cuando el número no tiene 10 dígitos: no se le puede mandar WhatsApp.
  telefono_whatsapp TEXT,
  nombre_contacto TEXT,
  es_principal BOOLEAN NOT NULL DEFAULT false,
  estatus TEXT NOT NULL DEFAULT 'activo' CHECK (estatus IN ('activo', 'invalido', 'baja')),
  -- Consentimiento para WhatsApp: Meta exige opt-in. `consentimiento_fuente`
  -- dice de dónde viene (contrato, verbal, el cliente escribió primero).
  consentimiento_whatsapp_fuente TEXT,
  consentimiento_whatsapp_at TIMESTAMPTZ,
  -- Baja: el cliente pidió no recibir mensajes. Bloquea todo envío automático.
  baja_whatsapp_at TIMESTAMPTZ,
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_col_contacts_siac
  ON col_contacts(client_id, campo_siac) WHERE origen = 'siac';
CREATE INDEX IF NOT EXISTS idx_col_contacts_whatsapp ON col_contacts(telefono_whatsapp) WHERE telefono_whatsapp IS NOT NULL;

-- Créditos tal como los da ConsultarCreditos. NoControl puede traer sufijos
-- ("1008 R", "1047 2D"), por eso es TEXT y se guarda tal cual. La llave incluye
-- el cliente porque ConsultarSaldoCredito pide NoControl + IDCliente.
CREATE TABLE IF NOT EXISTS col_credits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ambiente TEXT NOT NULL CHECK (ambiente IN ('pruebas', 'produccion')),
  client_id UUID NOT NULL REFERENCES col_clients(id) ON DELETE CASCADE,
  id_cliente_siac TEXT NOT NULL,
  no_control TEXT NOT NULL,
  tipo_credito TEXT,
  fecha_alta DATE NOT NULL,
  monto_credito NUMERIC(14, 2) NOT NULL,
  frecuencia_pago TEXT,
  numero_vencimientos INTEGER,
  esquema_pago TEXT,
  tasa_normal TEXT,
  tasa_normal_puntos NUMERIC(8, 4),
  tasa_moratoria TEXT,
  tasa_moratoria_puntos NUMERIC(8, 4),
  tasa_moratoria_factor NUMERIC(8, 4),
  -- Sin CHECK a propósito: solo hemos visto ACTIVO y PAGADO, pero SIAC puede
  -- tener otros estatus y no queremos que la sincronización truene por uno nuevo.
  estatus_siac TEXT NOT NULL,
  promotor TEXT,
  referencia TEXT,
  -- CondicionesFinanciamiento completo, por si hace falta un campo que no
  -- se promovió a columna.
  condiciones JSONB NOT NULL,
  -- Operación de cobranza (esto lo edita el equipo, no SIAC).
  asignado_a TEXT,
  -- NULL = la etapa (preventiva/temprana/tardía) se calcula con reglas.
  -- Un valor aquí es una decisión humana que manda sobre las reglas.
  etapa_manual TEXT CHECK (etapa_manual IN ('juridico', 'reestructura', 'pausado')),
  etapa_manual_por TEXT,
  etapa_manual_at TIMESTAMPTZ,
  -- Reconstrucción histórica (lib/collections/backfill.ts). NULL = pendiente.
  reconstruido_at TIMESTAMPTZ,
  reconstruccion_error TEXT,
  raw JSONB NOT NULL,
  last_synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (ambiente, id_cliente_siac, no_control)
);

-- Columnas agregadas después de la primera versión del esquema, por si la
-- tabla ya existía (mismo patrón que leads-schema.sql).
ALTER TABLE col_credits ADD COLUMN IF NOT EXISTS reconstruido_at TIMESTAMPTZ;
ALTER TABLE col_credits ADD COLUMN IF NOT EXISTS reconstruccion_error TEXT;

CREATE INDEX IF NOT EXISTS idx_col_credits_client ON col_credits(client_id);
CREATE INDEX IF NOT EXISTS idx_col_credits_activos ON col_credits(ambiente) WHERE estatus_siac = 'ACTIVO';

-- Foto diaria (o reconstruida) del saldo de un crédito, con todos los campos
-- de ConsultarSaldoCredito. Una fila por crédito y fecha de corte: si se vuelve
-- a pedir la misma fecha, se sobrescribe y col_siac_raw conserva lo anterior.
-- Nunca se guardan fechas de corte futuras (SIAC las proyecta).
CREATE TABLE IF NOT EXISTS col_balance_snapshots (
  id BIGSERIAL PRIMARY KEY,
  credit_id UUID NOT NULL REFERENCES col_credits(id) ON DELETE CASCADE,
  fecha_corte DATE NOT NULL,
  origen TEXT NOT NULL CHECK (origen IN ('diaria', 'reconstruccion', 'credito')),
  sync_run_id INTEGER REFERENCES col_sync_runs(id),

  saldo_vigente NUMERIC(14, 2) NOT NULL,
  capital_vigente NUMERIC(14, 2) NOT NULL,
  iva_capital_vigente NUMERIC(14, 2) NOT NULL,
  intereses_vigentes NUMERIC(14, 2) NOT NULL,
  iva_intereses_vigentes NUMERIC(14, 2) NOT NULL,
  comisiones_futuras NUMERIC(14, 2) NOT NULL,
  iva_comisiones_futuras NUMERIC(14, 2) NOT NULL,

  saldo_vencido NUMERIC(14, 2) NOT NULL,
  capital_vencido NUMERIC(14, 2) NOT NULL,
  iva_capital_vencido NUMERIC(14, 2) NOT NULL,
  intereses_vencidos NUMERIC(14, 2) NOT NULL,
  iva_intereses_vencidos NUMERIC(14, 2) NOT NULL,
  intereses_moratorios NUMERIC(14, 2) NOT NULL,
  iva_intereses_moratorios NUMERIC(14, 2) NOT NULL,
  comisiones_vencidas NUMERIC(14, 2) NOT NULL,
  iva_comisiones_vencidas NUMERIC(14, 2) NOT NULL,

  saldo_actual NUMERIC(14, 2) NOT NULL,
  total_pagar NUMERIC(14, 2) NOT NULL,
  saldo_global NUMERIC(14, 2) NOT NULL,
  cat TEXT,

  -- Sumatorias son acumulados de toda la vida del crédito. Lo cobrado en un
  -- periodo es la diferencia de `pagos` entre dos fotos.
  suma_ministraciones NUMERIC(14, 2) NOT NULL,
  suma_pagos NUMERIC(14, 2) NOT NULL,
  suma_comisiones NUMERIC(14, 2) NOT NULL,
  suma_condonaciones NUMERIC(14, 2) NOT NULL,
  suma_quitas NUMERIC(14, 2) NOT NULL,
  suma_castigos NUMERIC(14, 2) NOT NULL,

  -- Inicio de la racha actual de saldo vencido > 0, ubicado por bisección de
  -- fechas de corte. NULL cuando no hay vencido. Es una aproximación de "días
  -- de atraso" hasta confirmar con SIAC el orden de aplicación de pagos: con
  -- pagos parciales, la racha puede empezar antes que el vencimiento más
  -- antiguo pendiente.
  vencido_desde DATE,
  dias_atraso INTEGER GENERATED ALWAYS AS (fecha_corte - vencido_desde) STORED,

  fecha_calculo_siac DATE,
  obtenido_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (credit_id, fecha_corte)
);

CREATE INDEX IF NOT EXISTS idx_col_snapshots_fecha ON col_balance_snapshots(fecha_corte);
CREATE INDEX IF NOT EXISTS idx_col_snapshots_vencidos ON col_balance_snapshots(fecha_corte) WHERE saldo_vencido > 0;

-- Hechos financieros derivados de comparar fotos: un pago es un aumento de
-- suma_pagos, una entrada a vencido es el paso de saldo_vencido = 0 a > 0, etc.
-- `fecha_evento` es el día exacto (por bisección) y `detectado_en` es la
-- corrida que lo encontró. De aquí salen lo cobrado por día, las
-- regularizaciones (cure) y la verificación automática de promesas.
CREATE TABLE IF NOT EXISTS col_credit_events (
  id BIGSERIAL PRIMARY KEY,
  credit_id UUID NOT NULL REFERENCES col_credits(id) ON DELETE CASCADE,
  tipo TEXT NOT NULL CHECK (tipo IN (
    'pago', 'entrada_vencido', 'regularizacion', 'condonacion', 'quita', 'castigo'
  )),
  fecha_evento DATE NOT NULL,
  monto NUMERIC(14, 2),
  -- Saldo vencido justo antes y justo después del evento.
  vencido_antes NUMERIC(14, 2),
  vencido_despues NUMERIC(14, 2),
  detectado_en INTEGER REFERENCES col_sync_runs(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (credit_id, tipo, fecha_evento)
);

CREATE INDEX IF NOT EXISTS idx_col_events_fecha ON col_credit_events(fecha_evento);

CREATE TABLE IF NOT EXISTS col_promises (
  id SERIAL PRIMARY KEY,
  client_id UUID NOT NULL REFERENCES col_clients(id) ON DELETE CASCADE,
  -- NULL = la promesa es por el total del cliente, no de un crédito en particular.
  credit_id UUID REFERENCES col_credits(id) ON DELETE CASCADE,
  monto NUMERIC(14, 2) NOT NULL CHECK (monto > 0),
  fecha_compromiso DATE NOT NULL,
  canal TEXT CHECK (canal IN ('llamada', 'whatsapp', 'correo', 'visita', 'otro')),
  estado TEXT NOT NULL DEFAULT 'vigente' CHECK (estado IN ('vigente', 'cumplida', 'parcial', 'incumplida', 'cancelada')),
  -- Lo pagado entre la creación y la fecha compromiso (+ días de gracia),
  -- sumado de col_credit_events tipo 'pago'. Lo calcula el sistema.
  monto_pagado NUMERIC(14, 2) NOT NULL DEFAULT 0,
  -- sistema: se resolvió con los pagos de SIAC. manual: la resolvió una persona
  -- (por ejemplo, pagó a una cuenta que SIAC no ha conciliado).
  resuelta_por TEXT CHECK (resuelta_por IN ('sistema', 'manual')),
  resuelta_at TIMESTAMPTZ,
  notas TEXT,
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_col_promises_vigentes ON col_promises(fecha_compromiso) WHERE estado = 'vigente';
CREATE INDEX IF NOT EXISTS idx_col_promises_client ON col_promises(client_id);

-- Todos los mensajes de WhatsApp de cobranza, de entrada y salida, lo mande
-- quien lo mande (backoffice o n8n). Es el registro único contra duplicados:
-- `dedupe_key` es única, así que un segundo intento del mismo recordatorio
-- (por ejemplo 'mora:<client_id>:2026-10-01') falla en la base antes de
-- llegar a Meta.
CREATE TABLE IF NOT EXISTS col_wa_messages (
  id BIGSERIAL PRIMARY KEY,
  -- NULL en entrantes de números que no coinciden con ningún contacto.
  client_id UUID REFERENCES col_clients(id) ON DELETE SET NULL,
  contact_id UUID REFERENCES col_contacts(id) ON DELETE SET NULL,
  direccion TEXT NOT NULL CHECK (direccion IN ('entrante', 'saliente')),
  telefono TEXT NOT NULL,
  -- ID de Meta. Único para que un webhook reenviado no duplique el mensaje.
  wamid TEXT UNIQUE,
  tipo TEXT NOT NULL CHECK (tipo IN ('plantilla', 'texto', 'otro')),
  plantilla TEXT,
  parametros JSONB,
  cuerpo TEXT,
  estado TEXT NOT NULL CHECK (estado IN ('pendiente', 'enviado', 'entregado', 'leido', 'fallido', 'recibido')),
  error JSONB,
  origen TEXT NOT NULL CHECK (origen IN (
    'backoffice_manual', 'recordatorio_mora', 'n8n_preventiva', 'n8n_slack', 'cliente'
  )),
  dedupe_key TEXT UNIQUE,
  enviado_por TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  estado_actualizado_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_col_wa_client ON col_wa_messages(client_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_col_wa_telefono ON col_wa_messages(telefono, created_at DESC);

CREATE TABLE IF NOT EXISTS col_alerts (
  id SERIAL PRIMARY KEY,
  client_id UUID REFERENCES col_clients(id) ON DELETE CASCADE,
  credit_id UUID REFERENCES col_credits(id) ON DELETE CASCADE,
  tipo TEXT NOT NULL CHECK (tipo IN (
    'entrada_vencido', 'aumento_vencido', 'cambio_bucket', 'promesa_incumplida',
    'mensaje_fallido', 'telefono_invalido', 'sync_fallido'
  )),
  severidad TEXT NOT NULL CHECK (severidad IN ('info', 'atencion', 'critica')),
  estado TEXT NOT NULL DEFAULT 'abierta' CHECK (estado IN ('abierta', 'atendida', 'descartada')),
  -- Evita abrir la misma alerta dos veces mientras siga abierta
  -- (ver el índice único parcial de abajo).
  dedupe_key TEXT NOT NULL,
  detalle JSONB,
  atendida_por TEXT,
  atendida_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_col_alerts_abiertas ON col_alerts(dedupe_key) WHERE estado = 'abierta';
CREATE INDEX IF NOT EXISTS idx_col_alerts_client ON col_alerts(client_id);

-- Timeline del expediente: gestiones humanas y hitos del sistema, en orden.
-- Solo se escribe. Los detalles viven en su tabla (mensaje, promesa, evento,
-- alerta) y aquí se referencian, en la misma transacción que los crea.
-- `ocurrido_at` es cuándo pasó (un pago de ayer detectado hoy), `created_at`
-- cuándo se registró.
CREATE TABLE IF NOT EXISTS col_activities (
  id BIGSERIAL PRIMARY KEY,
  client_id UUID NOT NULL REFERENCES col_clients(id) ON DELETE CASCADE,
  credit_id UUID REFERENCES col_credits(id) ON DELETE CASCADE,
  tipo TEXT NOT NULL CHECK (tipo IN (
    'llamada', 'nota', 'visita', 'correo',
    'whatsapp_enviado', 'whatsapp_recibido',
    'promesa_creada', 'promesa_resuelta',
    'pago_detectado', 'entrada_vencido', 'regularizacion', 'ajuste_siac',
    'cambio_etapa', 'cambio_contacto', 'cambio_asignacion', 'pausa',
    'alerta'
  )),
  -- Para llamadas y visitas: qué pasó.
  resultado TEXT CHECK (resultado IN ('contesto', 'no_contesto', 'numero_equivocado', 'promesa', 'se_nego', 'otro')),
  descripcion TEXT,
  wa_message_id BIGINT REFERENCES col_wa_messages(id),
  promise_id INTEGER REFERENCES col_promises(id),
  event_id BIGINT REFERENCES col_credit_events(id),
  alert_id INTEGER REFERENCES col_alerts(id),
  metadata JSONB,
  -- Correo del usuario del backoffice, o 'sistema'.
  actor TEXT NOT NULL,
  ocurrido_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_col_activities_client ON col_activities(client_id, ocurrido_at DESC);
CREATE INDEX IF NOT EXISTS idx_col_activities_credit ON col_activities(credit_id, ocurrido_at DESC) WHERE credit_id IS NOT NULL;

-- Las tablas col_ guardan saldos y datos personales: RLS activo sin políticas
-- para que la API REST de Supabase no las exponga. La app y n8n entran como
-- postgres (BYPASSRLS) y no se ven afectados. Ver security.sql.
ALTER TABLE col_sync_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE col_siac_raw ENABLE ROW LEVEL SECURITY;
ALTER TABLE col_clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE col_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE col_credits ENABLE ROW LEVEL SECURITY;
ALTER TABLE col_balance_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE col_credit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE col_promises ENABLE ROW LEVEL SECURITY;
ALTER TABLE col_wa_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE col_alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE col_activities ENABLE ROW LEVEL SECURITY;
