-- Migración 037: Tabla de configuración para pg_cron
-- Almacena secretos que pg_cron necesita para invocar Edge Functions

CREATE TABLE IF NOT EXISTS public.pg_cron_config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  description TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Solo superuser puede leer/escribir
ALTER TABLE public.pg_cron_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin_only" ON public.pg_cron_config
  FOR ALL TO authenticated USING (false) WITH CHECK (false);

-- Insert o actualizar el service role key
-- NOTA: Este valor se debe insertar manualmente desde una sesión superuser
-- o desde el dashboard de Supabase ejecutando:
-- INSERT INTO public.pg_cron_config (key, value, description)
-- VALUES ('supabase_service_role_key', '<your-key>', 'Service role key for pg_cron')
-- ON CONFLICT (key) DO UPDATE SET value = excluded.value;

COMMENT ON TABLE public.pg_cron_config IS
  'Almacena configuración necesaria para pg_cron (secretos, URLs). '
  'Acceso restringido a superuser. Usar INSERT/UPDATE para actualizar valores.';
