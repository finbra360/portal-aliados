-- Anuncios leídos por broker, historial de etapas de cada solicitud y el mensaje
-- que Finbra le deja al broker en una solicitud. Idempotente: se puede correr
-- varias veces (el respaldo del historial solo corre cuando se crea la tabla).

CREATE TABLE IF NOT EXISTS announcement_reads (
  announcement_id INTEGER NOT NULL REFERENCES announcements(id) ON DELETE CASCADE,
  broker_id TEXT NOT NULL,
  read_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (announcement_id, broker_id)
);

ALTER TABLE operations ADD COLUMN IF NOT EXISTS mensaje_broker TEXT;

DO $$
BEGIN
  IF to_regclass('public.operation_history') IS NULL THEN
    CREATE TABLE operation_history (
      id BIGSERIAL PRIMARY KEY,
      operation_id INTEGER NOT NULL REFERENCES operations(id) ON DELETE CASCADE,
      etapa TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    -- Toda solicitud empieza como recibida.
    INSERT INTO operation_history (operation_id, etapa, created_at)
    SELECT id, 'recibida', created_at FROM operations;

    -- Los cambios de etapa que ya quedaron en la bitácora.
    INSERT INTO operation_history (operation_id, etapa, created_at)
    SELECT a.entity_id::int, a.metadata->>'newEtapa', a.created_at
    FROM audit_log a
    WHERE a.action = 'update_operation_stage'
      AND a.entity_type = 'operation'
      AND a.entity_id ~ '^[0-9]+$'
      AND a.metadata->>'newEtapa' IS NOT NULL
      AND EXISTS (SELECT 1 FROM operations o WHERE o.id = a.entity_id::int);

    -- Si la última etapa registrada no es la actual, se registra la actual.
    INSERT INTO operation_history (operation_id, etapa, created_at)
    SELECT o.id, o.etapa, o.updated_at
    FROM operations o
    WHERE o.etapa IS DISTINCT FROM (
      SELECT h.etapa FROM operation_history h WHERE h.operation_id = o.id ORDER BY h.created_at DESC, h.id DESC LIMIT 1
    );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_operation_history_operation ON operation_history (operation_id, created_at);

ALTER TABLE announcement_reads ENABLE ROW LEVEL SECURITY;
ALTER TABLE operation_history ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON announcement_reads, operation_history FROM anon, authenticated;
