-- Concursos por periodo: al finalizar un concurso se guardan sus ganadores (así el
-- resultado no cambia si después se corrige la colocación) y la fecha de cierre.
-- Idempotente: se puede correr varias veces.

ALTER TABLE contests ADD COLUMN IF NOT EXISTS finalizado_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS contest_winners (
  contest_id INTEGER NOT NULL REFERENCES contests(id) ON DELETE CASCADE,
  premio INTEGER NOT NULL,
  broker_id TEXT NOT NULL,
  nombre TEXT NOT NULL,
  valor NUMERIC(14, 2) NOT NULL,
  monto NUMERIC(14, 2) NOT NULL,
  operaciones INTEGER NOT NULL,
  PRIMARY KEY (contest_id, premio)
);

ALTER TABLE contest_winners ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON contest_winners FROM anon, authenticated;
