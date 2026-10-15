-- Brokers (aliados) en la base del backoffice. Hasta 2026-10 la lista vivía en
-- el Google Sheet "Brokers" (columnas Email, Nombre completo, ID Broker) que lee
-- el flujo de n8n "Broker Portal - API". Esta tabla la reemplaza: el alta, la
-- edición y la carga masiva se hacen desde el backoffice, y el login del portal
-- valida contra aquí.
--
-- La suspensión sigue en broker_status (schema.sql). La colocación vive en
-- broker_colocaciones (abajo); antes era la pestaña "Historial Colocacion".
--
-- Idempotente: se puede correr más de una vez.

CREATE TABLE IF NOT EXISTS brokers (
  -- El código de Lendia (FAPBR044) o, si no tiene, el B### que genera el
  -- backoffice. Es el ID que usa el historial de colocación.
  id TEXT PRIMARY KEY,
  -- Con este correo entra al portal de aliados (código por email). En minúsculas.
  email TEXT NOT NULL UNIQUE CHECK (email = lower(email) AND email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  nombre TEXT NOT NULL CHECK (length(trim(nombre)) > 0),
  telefono TEXT,
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Forma del ID (igual que ID_BROKER en lib/brokers/importar.ts). La primera
-- versión (2026-10-15) solo aceptaba B###; esto la reemplaza para aceptar los
-- códigos de Lendia.
ALTER TABLE brokers DROP CONSTRAINT IF EXISTS brokers_id_check;
ALTER TABLE brokers ADD CONSTRAINT brokers_id_check CHECK (id ~ '^[A-Z0-9][A-Z0-9-]{1,29}$');

-- Datos personales de los aliados: sin acceso por la API pública de Supabase.
-- (security.sql ya les quita a anon y authenticated los privilegios sobre
-- tablas nuevas.)
ALTER TABLE brokers ENABLE ROW LEVEL SECURITY;

-- Colocación de cada broker (créditos fondeados que trajo). Reemplaza al Sheet
-- "Historial Colocacion" que leía n8n. De aquí salen el total, el ranking y
-- las comisiones del portal y del backoffice.
CREATE TABLE IF NOT EXISTS broker_colocaciones (
  id BIGSERIAL PRIMARY KEY,
  broker_id TEXT NOT NULL REFERENCES brokers(id) ON UPDATE CASCADE,
  fecha DATE NOT NULL,
  monto NUMERIC(14,2) NOT NULL CHECK (monto > 0),
  -- % de comisión de apertura pactado con el cliente (define la comisión del broker). NULL = sin capturar.
  comision_apertura_pct NUMERIC(5,2) CHECK (comision_apertura_pct BETWEEN 0 AND 100),
  -- El cliente terminó de pagar el crédito (bono adicional para el broker).
  pagado_totalidad BOOLEAN NOT NULL DEFAULT false,
  -- Opcional: cliente o número de crédito, para distinguir operaciones iguales.
  referencia TEXT,
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_broker_colocaciones_broker ON broker_colocaciones(broker_id, fecha);

ALTER TABLE broker_colocaciones ENABLE ROW LEVEL SECURITY;
