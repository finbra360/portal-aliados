# Base de datos (Supabase Postgres)

La app se conecta con `DATABASE_URL` (pooler de Supabase en modo transacción). Estos `.sql` **no** se corren
solos: se aplican a mano en el SQL Editor de Supabase o con un script, en este orden. Los marcados como
idempotentes se pueden volver a correr sin riesgo.

## Orden

| # | Archivo | Qué crea |
|---|---------|----------|
| 1 | `schema.sql` | Núcleo del portal y backoffice: usuarios admin, estatus de brokers, operaciones, pagos de comisión, concursos, recursos, anuncios, bitácora. |
| 2 | `leads-schema.sql` | Motor de prospección B2B (tablas `lead_*`). Lo alimenta n8n. |
| 3 | `collections-schema.sql` | Cobranza (tablas `col_*`). |
| 4 | `brokers-schema.sql` | Tabla `brokers` y colocación (`broker_colocaciones`). Reemplaza al Google Sheet. |
| 5 | `commission-payments-colocacion.sql` | Los pagos de comisión se identifican por operación (`colocacion_id`). Idempotente. |
| 6 | `portal-login-schema.sql` | Intentos de login para los límites por correo y por conexión. Idempotente. |
| 7 | `anuncios-seguimiento-schema.sql` | Anuncios leídos, historial de etapas de cada solicitud y mensaje para el broker. Idempotente. |
| 8 | `concursos-periodo-schema.sql` | Cierre de concursos: fecha y ganadores fijados. Idempotente. |
| 9 | `security.sql` | **Siempre al final de cada tanda.** Activa RLS y quita permisos a `anon`/`authenticated` en todas las tablas de `public`. |

`seeds/` trae datos iniciales (paquetes de verticales del motor de leads). `fix-json-texto.sql` fue una reparación
única del 2026-10-14; no hace falta volver a correrla.

## Reglas al escribir consultas

- **Nunca `sql.begin`**: con el pooler falla. Usa `transaccion()` de `lib/db.ts`.
- Columnas `jsonb`: guarda con `${JSON.stringify(x)}::text::jsonb`, no con `::jsonb` directo.
- Cada tabla nueva lleva `ENABLE ROW LEVEL SECURITY` y `REVOKE ALL ... FROM anon, authenticated` (o correr `security.sql`).
- Compara fechas con la hora de la base (`now()`), no con la del servidor web: pueden diferir unos segundos.
