-- Cierre de la API REST de Supabase (PostgREST) sobre el esquema public.
-- Correr DESPUÉS de schema.sql y leads-schema.sql: el ENABLE RLS recorre las
-- tablas que ya existen. Se puede correr varias veces sin romper nada.
--
-- Por qué: Supabase les da a anon y authenticated todos los privilegios sobre
-- cada tabla nueva de public, y sin RLS cualquiera con la llave anon del
-- proyecto puede leer, escribir o vaciar las tablas vía /rest/v1 -- incluida
-- admin_users (alta de un super_admin) y lead_api_secrets.
--
-- No afecta a la app ni a n8n: ambos se conectan como postgres, que tiene
-- BYPASSRLS. Por eso es ENABLE y no FORCE: FORCE sí aplicaría RLS al dueño
-- de las tablas y rompería todo.

DO $$ DECLARE t text; BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
  END LOOP;
END $$;

REVOKE ALL ON ALL TABLES    IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;

-- Sin esto, cada tabla nueva (por ejemplo las col_* de cobranza) volvería a
-- nacer abierta para anon y authenticated.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON TABLES    FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon, authenticated;
