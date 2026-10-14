-- Reparación única (2026-10-14). Hasta esta fecha el backoffice guardaba sus
-- columnas JSONB con `${JSON.stringify(x)}::jsonb`: postgres.js ve que el
-- parámetro es jsonb y vuelve a serializar el texto, así que se guardaba un
-- JSON de tipo string ("{\"a\":1}") en lugar del objeto. El código ya usa
-- `::text::jsonb`. Este script convierte los valores viejos en objetos.
--
-- Idempotente: solo toca valores que hoy son un string JSON cuyo contenido
-- empieza con { o [. Se puede correr más de una vez.

BEGIN;

UPDATE audit_log SET metadata = (metadata #>> '{}')::jsonb
WHERE jsonb_typeof(metadata) = 'string' AND left(metadata #>> '{}', 1) IN ('{', '[');

UPDATE col_activities SET metadata = (metadata #>> '{}')::jsonb
WHERE jsonb_typeof(metadata) = 'string' AND left(metadata #>> '{}', 1) IN ('{', '[');

UPDATE col_alerts SET detalle = (detalle #>> '{}')::jsonb
WHERE jsonb_typeof(detalle) = 'string' AND left(detalle #>> '{}', 1) IN ('{', '[');

UPDATE col_credits SET raw = (raw #>> '{}')::jsonb
WHERE jsonb_typeof(raw) = 'string' AND left(raw #>> '{}', 1) IN ('{', '[');

UPDATE col_payments SET raw = (raw #>> '{}')::jsonb
WHERE jsonb_typeof(raw) = 'string' AND left(raw #>> '{}', 1) IN ('{', '[');

UPDATE col_saldo_consultas SET detalle = (detalle #>> '{}')::jsonb
WHERE jsonb_typeof(detalle) = 'string' AND left(detalle #>> '{}', 1) IN ('{', '[');

UPDATE col_siac_raw SET parametros = (parametros #>> '{}')::jsonb
WHERE jsonb_typeof(parametros) = 'string' AND left(parametros #>> '{}', 1) IN ('{', '[');

UPDATE col_siac_raw SET respuesta = (respuesta #>> '{}')::jsonb
WHERE jsonb_typeof(respuesta) = 'string' AND left(respuesta #>> '{}', 1) IN ('{', '[');

UPDATE col_wa_messages SET parametros = (parametros #>> '{}')::jsonb
WHERE jsonb_typeof(parametros) = 'string' AND left(parametros #>> '{}', 1) IN ('{', '[');

UPDATE col_wa_messages SET error = (error #>> '{}')::jsonb
WHERE jsonb_typeof(error) = 'string' AND left(error #>> '{}', 1) IN ('{', '[');

COMMIT;
