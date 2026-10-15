-- Brokers (aliados) en la base del backoffice. Hasta 2026-10 la lista vivía en
-- el Google Sheet "Brokers" (columnas Email, Nombre completo, ID Broker) que lee
-- el flujo de n8n "Broker Portal - API". Esta tabla la reemplaza: el alta, la
-- edición y la carga masiva se hacen desde el backoffice, y el login del portal
-- valida contra aquí (cambio en n8n aparte).
--
-- La suspensión sigue en broker_status (schema.sql). El historial de
-- colocación sigue en el Sheet "Historial Colocacion" por ahora.
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
