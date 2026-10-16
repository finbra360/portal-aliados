-- Los pagos de comisión pasan a identificarse por operación (broker_colocaciones.id)
-- y no por (broker, fecha): dos operaciones del mismo broker el mismo día chocaban
-- (marcar una como pagada marcaba las dos). Idempotente: se puede correr varias veces.

ALTER TABLE commission_payments ADD COLUMN IF NOT EXISTS colocacion_id BIGINT;

ALTER TABLE commission_payments DROP CONSTRAINT IF EXISTS commission_payments_broker_id_operacion_fecha_key;

-- Los pagos que ya existían se ligan a su operación cuando hay una sola con ese
-- broker, fecha y monto. Si hubiera dos iguales no se adivina: queda sin ligar.
UPDATE commission_payments p
SET colocacion_id = c.id
FROM broker_colocaciones c
WHERE p.colocacion_id IS NULL
  AND c.broker_id = p.broker_id
  AND c.fecha::text = p.operacion_fecha
  AND c.monto = p.operacion_monto
  AND (
    SELECT count(*) FROM broker_colocaciones c2
    WHERE c2.broker_id = p.broker_id AND c2.fecha::text = p.operacion_fecha AND c2.monto = p.operacion_monto
  ) = 1;

CREATE UNIQUE INDEX IF NOT EXISTS ux_commission_payments_colocacion
  ON commission_payments (colocacion_id) WHERE colocacion_id IS NOT NULL;
