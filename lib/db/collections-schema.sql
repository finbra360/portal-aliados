-- Collections OS (cobranza) — esquema Postgres
-- Vive en la misma base que schema.sql y leads-schema.sql, con tablas
-- prefijadas col_, igual que el motor de leads usa lead_.
--
-- Principios:
-- - SIAC es la fuente de verdad financiera. La foto diaria sale de UNA
--   llamada general a ListadoCobranzaJSON, que lee la foto que el Monitor de
--   Servicios de SIAC guarda a las 00:00. SIAC pidió no hacer cargas masivas
--   con servicios individuales: ConsultarSaldoCredito solo se usa bajo
--   demanda, crédito por crédito (col_saldo_consultas).
-- - col_clients, col_credits y col_credit_snapshots son un REFLEJO que escribe
--   solo la sincronización; la interfaz nunca edita esos campos ni consulta
--   SIAC en vivo.
-- - Lo que genera el equipo (contactos manuales, gestiones, promesas,
--   mensajes, configuración) vive en tablas propias, para que una
--   sincronización nunca lo pise.
-- - Todo lo que pasa con un cliente queda en col_activities (el timeline del
--   expediente), que solo se escribe y nunca se edita ni se borra.
-- - La cola de trabajo y los buckets de antigüedad NO son tablas: se calculan
--   con reglas en código (lib/collections/rules.ts).
--
-- Correr después de schema.sql y leads-schema.sql. Se puede correr varias
-- veces sin romper nada.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Configuración de cobranza que cambia sin desplegar código: umbral de mora,
-- ventana de envío. Cada cambio se registra en audit_log.
CREATE TABLE IF NOT EXISTS col_settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  descripcion TEXT,
  updated_by TEXT NOT NULL DEFAULT 'sistema',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO col_settings (key, value, descripcion) VALUES
  ('umbral_mora', '1000', 'Saldo vencido mínimo del cliente (MXN) para considerarlo en mora y mandarle recordatorio. Por debajo son residuos.'),
  ('ventana_envio', '{"desde": "09:00", "hasta": "19:00", "zona": "America/Mexico_City"}', 'Horario en que se permiten envíos automáticos de WhatsApp.'),
  ('carga_inicial_pagos', '{"autorizada": false}', 'Carga única de la historia de pagos (ConsultarPagos por crédito). Apagada hasta que SIAC dé el visto bueno.'),
  ('max_consultas_pagos_por_dia', '15', 'Tope de llamadas a ConsultarPagos que hace la foto diaria (solo créditos con un pago nuevo). Evita cargas masivas a SIAC.')
ON CONFLICT (key) DO NOTHING;

-- Una fila por corrida. `ambiente` existe porque se desarrolla contra la copia
-- de pruebas de SIAC (datos reales, congelados al 24-sep-2026): esos datos no
-- deben mezclarse con la operación real y hay que poder purgarlos completos.
CREATE TABLE IF NOT EXISTS col_sync_runs (
  id SERIAL PRIMARY KEY,
  ambiente TEXT NOT NULL CHECK (ambiente IN ('pruebas', 'produccion')),
  -- diaria: la foto general del día. consulta: saldo al día de un crédito, bajo demanda.
  -- pagos: carga inicial de la historia de pagos.
  tipo TEXT NOT NULL CHECK (tipo IN ('diaria', 'consulta', 'pagos')),
  fecha_corte DATE,
  -- foto_vieja: SIAC regresó exactamente la foto anterior (el Monitor de
  -- Servicios no corrió). No se guarda nada y se reintenta más tarde.
  status TEXT NOT NULL DEFAULT 'iniciado' CHECK (status IN ('iniciado', 'completado', 'foto_vieja', 'error')),
  creditos_leidos INTEGER NOT NULL DEFAULT 0,
  clientes_leidos INTEGER NOT NULL DEFAULT 0,
  eventos INTEGER NOT NULL DEFAULT 0,
  alertas INTEGER NOT NULL DEFAULT 0,
  llamadas_siac INTEGER NOT NULL DEFAULT 0,
  duracion_siac_ms INTEGER,
  error_detalle TEXT,
  disparado_por TEXT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_col_sync_runs_fecha ON col_sync_runs(ambiente, fecha_corte, status);

-- Bases creadas con la versión del 29-sep-2026 del esquema: su CHECK de tipo no
-- incluía 'pagos'. Se vuelve a crear con la lista vigente.
ALTER TABLE col_sync_runs DROP CONSTRAINT IF EXISTS col_sync_runs_tipo_check;
ALTER TABLE col_sync_runs ADD CONSTRAINT col_sync_runs_tipo_check CHECK (tipo IN ('diaria', 'consulta', 'pagos'));

-- Respuesta cruda de cada llamada a SIAC, mismo patrón que lead_sources.raw_payload:
-- permite reprocesar sin volver a llamar a SIAC y auditar qué dijo SIAC en su
-- momento. `parametros` NUNCA incluye RazonSocial ni la clave.
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

-- Clientes tal como vienen en el listado (InformacionGeneral.NumeroCliente).
CREATE TABLE IF NOT EXISTS col_clients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ambiente TEXT NOT NULL CHECK (ambiente IN ('pruebas', 'produccion')),
  numero_cliente TEXT NOT NULL,
  nombre TEXT NOT NULL,
  domicilio_particular TEXT,
  domicilio_trabajo TEXT,
  -- Pausa manual de la cobranza automática (negociación en curso, fallecimiento…).
  -- La cola y los recordatorios la respetan.
  pausa_hasta DATE,
  pausa_motivo TEXT,
  primera_vez_visto_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (ambiente, numero_cliente)
);

-- Teléfonos y correos. Separados de col_clients porque el equipo corrige y
-- agrega contactos, y la sincronización no debe pisar esas correcciones: una
-- fila con origen='siac' la actualiza la sincronización; una con
-- origen='manual' solo la toca el equipo.
--
-- `relacion`: los envíos automáticos van SOLO al titular. El aval se contacta
-- únicamente por decisión humana y las referencias nunca para cobrar, hasta
-- que el área legal valide otra cosa (regulación de cobranza de CONDUSEF).
CREATE TABLE IF NOT EXISTS col_contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES col_clients(id) ON DELETE CASCADE,
  origen TEXT NOT NULL CHECK (origen IN ('siac', 'manual')),
  relacion TEXT NOT NULL CHECK (relacion IN ('titular', 'aval', 'referencia')),
  -- Campo del listado del que salió (Celular, TelefonoCliente, CorreoCliente,
  -- TelefonoAval, CorreoAval, TelefonoReferencia1, TelefonoReferencia2). Es la
  -- llave para que la sincronización actualice en vez de duplicar.
  campo_siac TEXT,
  tipo TEXT NOT NULL CHECK (tipo IN ('telefono', 'email')),
  valor_original TEXT NOT NULL,
  -- Teléfono normalizado a 52 + 10 dígitos. NULL cuando no tiene 10 dígitos:
  -- no se le puede mandar WhatsApp y hay que corregirlo en SIAC.
  telefono_whatsapp TEXT,
  nombre_contacto TEXT,
  -- Sugerido por SIAC: Celular del titular o, si viene vacío, TelefonoCliente.
  -- Lo decide la sincronización cada día. Si el equipo eligió otro contacto
  -- (col_clients.contacto_cobranza_id), manda el del equipo.
  es_principal BOOLEAN NOT NULL DEFAULT false,
  estatus TEXT NOT NULL DEFAULT 'activo' CHECK (estatus IN ('activo', 'invalido', 'baja')),
  -- Meta exige opt-in. `fuente`: contrato, verbal, el cliente escribió primero.
  consentimiento_whatsapp_fuente TEXT,
  consentimiento_whatsapp_at TIMESTAMPTZ,
  -- El cliente pidió no recibir mensajes. Bloquea todo envío automático.
  baja_whatsapp_at TIMESTAMPTZ,
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_col_contacts_siac
  ON col_contacts(client_id, campo_siac) WHERE origen = 'siac';
CREATE INDEX IF NOT EXISTS idx_col_contacts_whatsapp ON col_contacts(telefono_whatsapp) WHERE telefono_whatsapp IS NOT NULL;

-- Agregadas el 2026-10-01 para el perfil del cliente.
-- rol: para contactos del deudor (relacion = 'titular'), quién es en la
-- empresa. NULL = sin clasificar. La sincronización nunca cambia rol ni relación.
ALTER TABLE col_contacts ADD COLUMN IF NOT EXISTS rol TEXT CHECK (rol IN ('dueno', 'pagos', 'contabilidad', 'otro'));
ALTER TABLE col_contacts ADD COLUMN IF NOT EXISTS notas TEXT;
ALTER TABLE col_contacts ADD COLUMN IF NOT EXISTS updated_by TEXT;

-- Contacto que eligió el equipo para recibir los recordatorios de cobranza.
-- NULL = se usa el sugerido por SIAC (col_contacts.es_principal). Solo puede
-- ser un contacto del deudor; la sincronización nunca lo cambia.
ALTER TABLE col_clients ADD COLUMN IF NOT EXISTS contacto_cobranza_id UUID REFERENCES col_contacts(id) ON DELETE SET NULL;
ALTER TABLE col_clients ADD COLUMN IF NOT EXISTS contacto_cobranza_por TEXT;
ALTER TABLE col_clients ADD COLUMN IF NOT EXISTS contacto_cobranza_at TIMESTAMPTZ;

-- Agregadas el 2026-10-02. Cuentas de Finbra a las que los clientes transfieren
-- sus pagos; los recordatorios incluyen la cuenta del cliente. No vienen de SIAC
-- (su campo Referencia llega vacío). La CLABE no se edita: una cuenta distinta
-- es otra fila, para que cambiar a dónde paga un cliente sea siempre explícito.
CREATE TABLE IF NOT EXISTS col_payment_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  alias TEXT NOT NULL,
  banco TEXT NOT NULL,
  beneficiario TEXT NOT NULL,
  clabe TEXT NOT NULL UNIQUE CHECK (clabe ~ '^[0-9]{18}$'),
  activa BOOLEAN NOT NULL DEFAULT true,
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Cuenta a la que paga el cliente. NULL = sin cuenta: no recibe recordatorios
-- y, si está en mora, se le abre la alerta sin_cuenta_pago.
ALTER TABLE col_clients ADD COLUMN IF NOT EXISTS cuenta_pago_id UUID REFERENCES col_payment_accounts(id);
ALTER TABLE col_clients ADD COLUMN IF NOT EXISTS cuenta_pago_por TEXT;
ALTER TABLE col_clients ADD COLUMN IF NOT EXISTS cuenta_pago_at TIMESTAMPTZ;

-- El ajuste único 'deposito' quedó reemplazado por el catálogo. Solo se borra
-- si nunca se llenó.
DELETE FROM col_settings
WHERE key = 'deposito' AND value = '{"clabe": null, "banco": null, "beneficiario": null}'::jsonb;

-- Créditos del listado. NoCredito puede traer sufijos ("1008 R", "1047 2D"),
-- por eso es TEXT. La llave incluye al cliente porque SIAC no ha confirmado
-- que NoCredito sea único en toda la cartera.
CREATE TABLE IF NOT EXISTS col_credits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ambiente TEXT NOT NULL CHECK (ambiente IN ('pruebas', 'produccion')),
  client_id UUID NOT NULL REFERENCES col_clients(id) ON DELETE CASCADE,
  numero_cliente TEXT NOT NULL,
  no_credito TEXT NOT NULL,
  tipo_credito TEXT,
  tipo_producto TEXT,
  referencia TEXT,
  sucursal TEXT,
  municipio TEXT,
  id_cobrador TEXT,
  nombre_promotor TEXT,
  programa_especial TEXT,
  tasa NUMERIC(10, 4),
  monto_credito NUMERIC(14, 2),
  -- FechaAlta de SIAC no es confiable (llega 0001-01-01): se usa FechaMinistracion.
  fecha_ministracion DATE,
  fecha_termino_contrato DATE,
  vencimientos INTEGER,
  plazo_meses INTEGER,
  frecuencia_pagos TEXT,
  -- false cuando el crédito dejó de aparecer en el listado (liquidado o fuera de cartera activa).
  en_listado BOOLEAN NOT NULL DEFAULT true,
  ultimo_listado DATE,
  -- Última vez que se trajo su historia de pagos con ConsultarPagos. NULL = nunca
  -- (pendiente de la carga inicial).
  pagos_sincronizados_at TIMESTAMPTZ,
  -- Operación de cobranza (esto lo edita el equipo, no SIAC).
  asignado_a TEXT,
  -- NULL = la etapa (preventiva/temprana/tardía) se calcula con reglas.
  -- Un valor aquí es una decisión humana que manda sobre las reglas.
  etapa_manual TEXT CHECK (etapa_manual IN ('juridico', 'reestructura', 'pausado')),
  etapa_manual_por TEXT,
  etapa_manual_at TIMESTAMPTZ,
  raw JSONB NOT NULL,
  last_synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (ambiente, numero_cliente, no_credito)
);

-- Columna agregada después de la versión del 29-sep-2026.
ALTER TABLE col_credits ADD COLUMN IF NOT EXISTS pagos_sincronizados_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_col_credits_client ON col_credits(client_id);
CREATE INDEX IF NOT EXISTS idx_col_credits_listado ON col_credits(ambiente) WHERE en_listado;

-- Foto diaria de cada crédito, tal como la da ListadoCobranzaJSON. Una fila
-- por crédito y fecha de corte; volver a correr el mismo día la sobrescribe.
CREATE TABLE IF NOT EXISTS col_credit_snapshots (
  id BIGSERIAL PRIMARY KEY,
  credit_id UUID NOT NULL REFERENCES col_credits(id) ON DELETE CASCADE,
  fecha_corte DATE NOT NULL,
  sync_run_id INTEGER REFERENCES col_sync_runs(id),

  -- CobranzaRespuesta. `antiguedad` son los días de atraso oficiales de SIAC.
  antiguedad INTEGER NOT NULL,
  atraso_maximo INTEGER,
  fecha_ultimo_pago DATE,
  numero_veces_mora INTEGER,
  vencimientos_cubiertos INTEGER,
  vencimientos_vencidos INTEGER,
  vencimientos_por_vencer INTEGER,
  dias_sin_movimiento INTEGER,
  -- NULL cuando SIAC manda 1800-01-01 (ya no hay pagos futuros).
  proximo_vencimiento DATE,
  -- Todo lo que falta por vencer. NO es la mensualidad.
  monto_por_vencer NUMERIC(14, 2),

  -- Vencido. Qué es exactamente total_adeudo frente a total_global está
  -- pendiente de que SIAC lo defina; la interfaz muestra los nombres de SIAC.
  intereses_moratorios NUMERIC(14, 2) NOT NULL,
  iva_vencido NUMERIC(14, 2) NOT NULL,
  total_vencido NUMERIC(14, 2) NOT NULL,
  total_adeudo NUMERIC(14, 2) NOT NULL,
  total_global NUMERIC(14, 2) NOT NULL,

  obtenido_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (credit_id, fecha_corte)
);

CREATE INDEX IF NOT EXISTS idx_col_snapshots_fecha ON col_credit_snapshots(fecha_corte);
CREATE INDEX IF NOT EXISTS idx_col_snapshots_mora ON col_credit_snapshots(fecha_corte) WHERE antiguedad > 0;

-- "Saldo al día" que pide una persona desde el expediente con
-- ConsultarSaldoCredito (individual, bajo demanda). Separado de la foto diaria
-- porque tiene otra forma y otra fuente.
CREATE TABLE IF NOT EXISTS col_saldo_consultas (
  id BIGSERIAL PRIMARY KEY,
  credit_id UUID NOT NULL REFERENCES col_credits(id) ON DELETE CASCADE,
  fecha_corte DATE NOT NULL,
  saldo_vigente NUMERIC(14, 2),
  saldo_vencido NUMERIC(14, 2),
  total_pagar NUMERIC(14, 2),
  saldo_actual NUMERIC(14, 2),
  -- Desglose completo (capital, intereses, moratorios, comisiones, IVA, sumatorias).
  detalle JSONB NOT NULL,
  pedido_por TEXT NOT NULL,
  sync_run_id INTEGER REFERENCES col_sync_runs(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_col_saldo_consultas_credit ON col_saldo_consultas(credit_id, created_at DESC);

-- Hechos derivados de comparar la foto de hoy con la anterior.
-- - pago_detectado: cambió FechaUltimoPago. Sin monto: el listado no lo trae
--   (llega con ConsultarPagos, ver col_payments).
-- - entrada_mora: pasó de 0 a >0 días de atraso. Su fecha es la de corte
--   menos la antigüedad, así que es exacta aunque falten fotos.
-- - regularizacion: pasó de >0 a 0 días de atraso.
-- - nueva_mensualidad_vencida: subió VencimientosVencidos estando en atraso.
-- - salida_listado: el crédito dejó de aparecer en el listado.
CREATE TABLE IF NOT EXISTS col_credit_events (
  id BIGSERIAL PRIMARY KEY,
  credit_id UUID NOT NULL REFERENCES col_credits(id) ON DELETE CASCADE,
  tipo TEXT NOT NULL CHECK (tipo IN (
    'pago_detectado', 'entrada_mora', 'regularizacion', 'nueva_mensualidad_vencida', 'salida_listado'
  )),
  fecha_evento DATE NOT NULL,
  antiguedad_antes INTEGER,
  antiguedad_despues INTEGER,
  vencido_antes NUMERIC(14, 2),
  vencido_despues NUMERIC(14, 2),
  detectado_en INTEGER REFERENCES col_sync_runs(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (credit_id, tipo, fecha_evento)
);

CREATE INDEX IF NOT EXISTS idx_col_events_fecha ON col_credit_events(fecha_evento);

-- Pagos de ConsultarPagos (por crédito; regresa toda su historia en una
-- llamada). Para no hacer cargas masivas a SIAC se llama solo:
-- - en la foto diaria, para los créditos con un pago nuevo (cambió
--   FechaUltimoPago), con un tope diario (col_settings.max_consultas_pagos_por_dia);
-- - una vez por crédito en la carga inicial, cuando SIAC la autorice;
-- - bajo demanda desde el expediente.
-- SIAC no da un identificador único por pago (NoPago llega en 1), así que la
-- llave es una huella de sus campos más un contador para pagos idénticos.
-- La versión del 29-sep-2026 creó col_payments con otra estructura (fecha_pago,
-- id_pago_siac) que nunca se llenó. Si existe con esa estructura y está vacía, se
-- reemplaza; si tuviera datos, el script se detiene para revisarlo a mano.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'col_payments' AND column_name = 'fecha_pago'
  ) THEN
    IF EXISTS (SELECT 1 FROM col_payments) THEN
      RAISE EXCEPTION 'col_payments tiene datos con la estructura anterior; revisar a mano antes de actualizar';
    END IF;
    DROP TABLE col_payments;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS col_payments (
  id BIGSERIAL PRIMARY KEY,
  credit_id UUID NOT NULL REFERENCES col_credits(id) ON DELETE CASCADE,
  -- Cuándo se aplicó el pago al crédito. Es la fecha que cuenta para promesas y cobranza.
  fecha_aplicacion DATE NOT NULL,
  -- Cuándo se capturó en SIAC; puede ser posterior a la aplicación.
  fecha_captura DATE,
  monto NUMERIC(14, 2) NOT NULL,
  no_pago INTEGER,
  concepto TEXT,
  comentario TEXT,
  huella TEXT NOT NULL,
  ocurrencia INTEGER NOT NULL DEFAULT 1,
  sync_run_id INTEGER REFERENCES col_sync_runs(id),
  raw JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (credit_id, huella, ocurrencia)
);

CREATE INDEX IF NOT EXISTS idx_col_payments_fecha ON col_payments(fecha_aplicacion);
CREATE INDEX IF NOT EXISTS idx_col_payments_credit ON col_payments(credit_id, fecha_aplicacion);

CREATE TABLE IF NOT EXISTS col_promises (
  id SERIAL PRIMARY KEY,
  client_id UUID NOT NULL REFERENCES col_clients(id) ON DELETE CASCADE,
  -- NULL = la promesa es por el total del cliente, no de un crédito.
  credit_id UUID REFERENCES col_credits(id) ON DELETE CASCADE,
  monto NUMERIC(14, 2) NOT NULL CHECK (monto > 0),
  fecha_compromiso DATE NOT NULL,
  -- Vencido del cliente (o del crédito) al registrar la promesa. Solo se usa
  -- cuando faltan los montos de pago (ver rules.ts: resolvePromiseAproximada).
  vencido_al_crear NUMERIC(14, 2) NOT NULL,
  canal TEXT CHECK (canal IN ('llamada', 'whatsapp', 'correo', 'visita', 'otro')),
  estado TEXT NOT NULL DEFAULT 'vigente' CHECK (estado IN ('vigente', 'cumplida', 'parcial', 'incumplida', 'cancelada')),
  -- sistema: la resolvió la sincronización (con pagos de SIAC o aproximado, ver rules.ts).
  -- manual: la resolvió una persona.
  resuelta_por TEXT CHECK (resuelta_por IN ('sistema', 'manual')),
  resuelta_at TIMESTAMPTZ,
  notas TEXT,
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_col_promises_vigentes ON col_promises(fecha_compromiso) WHERE estado = 'vigente';
CREATE INDEX IF NOT EXISTS idx_col_promises_client ON col_promises(client_id);

-- Plantillas de WhatsApp de Meta. Los recordatorios de mora rotan entre las
-- activas y aprobadas, en `orden`, para no repetir el mismo texto cada día.
CREATE TABLE IF NOT EXISTS col_wa_templates (
  id SERIAL PRIMARY KEY,
  nombre TEXT NOT NULL UNIQUE,
  idioma TEXT NOT NULL DEFAULT 'es_MX',
  categoria TEXT NOT NULL DEFAULT 'UTILITY',
  uso TEXT NOT NULL CHECK (uso IN ('mora', 'preventiva', 'otro')),
  -- Qué va en cada variable, en orden: ["nombre", "creditos", "total_vencido"].
  variables JSONB NOT NULL,
  estado_meta TEXT NOT NULL DEFAULT 'pendiente' CHECK (estado_meta IN ('pendiente', 'aprobada', 'rechazada', 'pausada')),
  activa BOOLEAN NOT NULL DEFAULT false,
  orden INTEGER NOT NULL DEFAULT 0,
  updated_by TEXT NOT NULL DEFAULT 'sistema',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO col_wa_templates (nombre, uso, variables, orden) VALUES
  ('finbra_mora_v1', 'mora', '["nombre", "creditos", "total_vencido"]', 1),
  ('finbra_mora_v2', 'mora', '["nombre", "creditos", "total_vencido"]', 2),
  ('finbra_mora_v3', 'mora', '["nombre", "creditos", "total_vencido"]', 3)
ON CONFLICT (nombre) DO NOTHING;

-- Todos los mensajes de WhatsApp de cobranza, de entrada y salida, lo mande
-- quien lo mande (backoffice o n8n). Es el registro único contra duplicados:
-- `dedupe_key` es única ('mora:<client_id>:2026-10-01'), así que un segundo
-- intento del mismo recordatorio falla en la base antes de llegar a Meta.
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
  template_id INTEGER REFERENCES col_wa_templates(id),
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
    'entrada_mora', 'nueva_mensualidad_vencida', 'cambio_bucket', 'promesa_incumplida',
    'mensaje_fallido', 'telefono_invalido', 'sin_cuenta_pago', 'sync_fallido', 'foto_vieja'
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

-- Bases creadas antes del 2026-10-02: su CHECK no incluía 'sin_cuenta_pago'.
ALTER TABLE col_alerts DROP CONSTRAINT IF EXISTS col_alerts_tipo_check;
ALTER TABLE col_alerts ADD CONSTRAINT col_alerts_tipo_check CHECK (tipo IN (
  'entrada_mora', 'nueva_mensualidad_vencida', 'cambio_bucket', 'promesa_incumplida',
  'mensaje_fallido', 'telefono_invalido', 'sin_cuenta_pago', 'sync_fallido', 'foto_vieja'
));

CREATE UNIQUE INDEX IF NOT EXISTS idx_col_alerts_abiertas ON col_alerts(dedupe_key) WHERE estado = 'abierta';
CREATE INDEX IF NOT EXISTS idx_col_alerts_client ON col_alerts(client_id);

-- Timeline del expediente: gestiones humanas y hitos del sistema, en orden.
-- Solo se escribe. Los detalles viven en su tabla (mensaje, promesa, evento,
-- alerta) y aquí se referencian, en la misma transacción que los crea.
-- `ocurrido_at` es cuándo pasó; `created_at`, cuándo se registró.
CREATE TABLE IF NOT EXISTS col_activities (
  id BIGSERIAL PRIMARY KEY,
  client_id UUID NOT NULL REFERENCES col_clients(id) ON DELETE CASCADE,
  credit_id UUID REFERENCES col_credits(id) ON DELETE CASCADE,
  tipo TEXT NOT NULL CHECK (tipo IN (
    'llamada', 'nota', 'visita', 'correo',
    'whatsapp_enviado', 'whatsapp_recibido',
    'promesa_creada', 'promesa_resuelta',
    'pago_detectado', 'pago_registrado', 'entrada_mora', 'regularizacion', 'nueva_mensualidad_vencida', 'salida_listado',
    'saldo_consultado', 'cambio_etapa', 'cambio_contacto', 'cambio_cuenta_pago', 'cambio_asignacion', 'pausa',
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

-- Bases creadas antes: su CHECK de tipo no incluía 'pago_registrado' (versión del
-- 29-sep-2026) ni 'cambio_cuenta_pago' (2026-10-02). Se vuelve a crear con la lista vigente.
ALTER TABLE col_activities DROP CONSTRAINT IF EXISTS col_activities_tipo_check;
ALTER TABLE col_activities ADD CONSTRAINT col_activities_tipo_check CHECK (tipo IN (
  'llamada', 'nota', 'visita', 'correo',
  'whatsapp_enviado', 'whatsapp_recibido',
  'promesa_creada', 'promesa_resuelta',
  'pago_detectado', 'pago_registrado', 'entrada_mora', 'regularizacion', 'nueva_mensualidad_vencida', 'salida_listado',
  'saldo_consultado', 'cambio_etapa', 'cambio_contacto', 'cambio_cuenta_pago', 'cambio_asignacion', 'pausa',
  'alerta'
));

CREATE INDEX IF NOT EXISTS idx_col_activities_client ON col_activities(client_id, ocurrido_at DESC);
CREATE INDEX IF NOT EXISTS idx_col_activities_credit ON col_activities(credit_id, ocurrido_at DESC) WHERE credit_id IS NOT NULL;

-- Las tablas col_ guardan saldos y datos personales: RLS activo sin políticas
-- para que la API REST de Supabase no las exponga. La app y n8n entran como
-- postgres (BYPASSRLS) y no se ven afectados. Ver security.sql.
ALTER TABLE col_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE col_sync_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE col_siac_raw ENABLE ROW LEVEL SECURITY;
ALTER TABLE col_clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE col_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE col_credits ENABLE ROW LEVEL SECURITY;
ALTER TABLE col_credit_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE col_saldo_consultas ENABLE ROW LEVEL SECURITY;
ALTER TABLE col_credit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE col_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE col_promises ENABLE ROW LEVEL SECURITY;
ALTER TABLE col_wa_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE col_wa_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE col_alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE col_activities ENABLE ROW LEVEL SECURITY;
ALTER TABLE col_payment_accounts ENABLE ROW LEVEL SECURITY;
