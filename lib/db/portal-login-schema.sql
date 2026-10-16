-- Intentos de login del portal de brokers (para limitar solicitudes de código y
-- fallos al verificarlo). Se puede correr varias veces sin romper nada.
-- Guarda el correo tal como lo escribió quien intenta (exista o no como broker)
-- y una huella de la IP, no la IP.

CREATE TABLE IF NOT EXISTS portal_login_intentos (
  id BIGSERIAL PRIMARY KEY,
  tipo TEXT NOT NULL CHECK (tipo IN ('codigo', 'verificar')),
  email TEXT NOT NULL,
  ip_hash TEXT NOT NULL,
  ok BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_portal_login_email ON portal_login_intentos (email, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_portal_login_ip ON portal_login_intentos (ip_hash, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_portal_login_created ON portal_login_intentos (created_at);

-- Igual que el resto de las tablas (ver security.sql): cerrada a la API REST de Supabase.
ALTER TABLE portal_login_intentos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON portal_login_intentos FROM anon, authenticated;
REVOKE ALL ON SEQUENCE portal_login_intentos_id_seq FROM anon, authenticated;
