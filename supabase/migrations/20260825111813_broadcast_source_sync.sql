-- Procedencia y auditoría para la sincronización oficial de emisiones en el VPS.
-- La migración no programa ejecuciones ni concede acceso a otros dominios.

CREATE SCHEMA IF NOT EXISTS private;

CREATE TABLE private.broadcast_source_links (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  source text NOT NULL CHECK (source IN ('hbo_max', 'rtve')),
  external_event_id text NOT NULL,
  race_day_id text NOT NULL REFERENCES public.race_days(id) ON DELETE RESTRICT,
  primary_broadcast_id text NOT NULL REFERENCES public.broadcasts(id) ON DELETE RESTRICT,
  mirror_broadcast_id text REFERENCES public.broadcasts(id) ON DELETE RESTRICT,
  managed_fields jsonb NOT NULL DEFAULT '["startTimeUtc","url"]'::jsonb,
  last_source_hash text NOT NULL,
  last_applied jsonb NOT NULL,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  manual_lock boolean NOT NULL DEFAULT false,
  manual_lock_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source, external_event_id),
  CHECK ((source = 'hbo_max' AND mirror_broadcast_id IS NOT NULL) OR source <> 'hbo_max')
);

CREATE UNIQUE INDEX broadcast_source_links_primary_broadcast_uidx
  ON private.broadcast_source_links(primary_broadcast_id);
CREATE UNIQUE INDEX broadcast_source_links_mirror_broadcast_uidx
  ON private.broadcast_source_links(mirror_broadcast_id)
  WHERE mirror_broadcast_id IS NOT NULL;

CREATE TABLE private.broadcast_source_observations (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  source text NOT NULL CHECK (source IN ('hbo_max', 'rtve')),
  external_event_id text NOT NULL,
  source_url text NOT NULL,
  observed_at timestamptz NOT NULL DEFAULT now(),
  parser_version text NOT NULL,
  source_hash text NOT NULL,
  normalized jsonb NOT NULL,
  match_evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL CHECK (status IN (
    'shadow_matched', 'unmatched', 'ambiguous', 'pending_stability',
    'manual_lock', 'manual_conflict', 'optimistic_conflict',
    'implausible_change', 'applied_insert', 'applied_update', 'unchanged',
    'source_failure', 'rollback'
  )),
  before_state jsonb,
  after_state jsonb,
  error text
);

ALTER TABLE private.broadcast_source_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.broadcast_source_observations ENABLE ROW LEVEL SECURITY;

CREATE INDEX broadcast_source_observations_event_idx
  ON private.broadcast_source_observations(source, external_event_id, observed_at DESC);
CREATE INDEX broadcast_source_observations_status_idx
  ON private.broadcast_source_observations(status, observed_at DESC);

REVOKE ALL ON TABLE private.broadcast_source_links FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE private.broadcast_source_observations FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE private.broadcast_source_links FROM service_role;
REVOKE ALL ON TABLE private.broadcast_source_observations FROM service_role;
REVOKE ALL ON SEQUENCE private.broadcast_source_links_id_seq FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SEQUENCE private.broadcast_source_observations_id_seq FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SEQUENCE private.broadcast_source_links_id_seq FROM service_role;
REVOKE ALL ON SEQUENCE private.broadcast_source_observations_id_seq FROM service_role;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'cc_broadcasts_worker') THEN
    CREATE ROLE cc_broadcasts_worker
      NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOINHERIT;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'cc_broadcasts_login') THEN
    CREATE ROLE cc_broadcasts_login
      NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION INHERIT;
  END IF;
END
$$;

GRANT cc_broadcasts_worker TO cc_broadcasts_login;

GRANT CONNECT ON DATABASE postgres TO cc_broadcasts_worker;
GRANT USAGE ON SCHEMA public, private TO cc_broadcasts_worker;
GRANT SELECT ON TABLE public.races, public.race_days, public.broadcasts TO cc_broadcasts_worker;
GRANT INSERT (id, "raceDayId", channel, country, "startTimeUtc", url, note, "sortOrder", translations)
  ON public.broadcasts TO cc_broadcasts_worker;
GRANT UPDATE (channel, country, "startTimeUtc", url, note, "sortOrder")
  ON public.broadcasts TO cc_broadcasts_worker;
GRANT UPDATE ("tvStatus") ON public.race_days TO cc_broadcasts_worker;
GRANT SELECT, INSERT, UPDATE ON TABLE private.broadcast_source_links TO cc_broadcasts_worker;
GRANT SELECT, INSERT ON TABLE private.broadcast_source_observations TO cc_broadcasts_worker;
GRANT USAGE, SELECT ON SEQUENCE
  private.broadcast_source_links_id_seq,
  private.broadcast_source_observations_id_seq
TO cc_broadcasts_worker;

CREATE POLICY cc_broadcasts_worker_links_read ON private.broadcast_source_links
  FOR SELECT TO cc_broadcasts_worker USING (true);
CREATE POLICY cc_broadcasts_worker_links_insert ON private.broadcast_source_links
  FOR INSERT TO cc_broadcasts_worker WITH CHECK (true);
CREATE POLICY cc_broadcasts_worker_links_update ON private.broadcast_source_links
  FOR UPDATE TO cc_broadcasts_worker USING (true) WITH CHECK (true);
CREATE POLICY cc_broadcasts_worker_observations_read ON private.broadcast_source_observations
  FOR SELECT TO cc_broadcasts_worker USING (true);
CREATE POLICY cc_broadcasts_worker_observations_insert ON private.broadcast_source_observations
  FOR INSERT TO cc_broadcasts_worker WITH CHECK (true);

-- Las tablas públicas tienen RLS. El rol queda limitado a lectura y a las dos
-- operaciones de emisiones que necesita el sincronizador; no recibe DELETE.
CREATE POLICY cc_broadcasts_worker_read_races ON public.races
  FOR SELECT TO cc_broadcasts_worker USING (true);
CREATE POLICY cc_broadcasts_worker_read_race_days ON public.race_days
  FOR SELECT TO cc_broadcasts_worker USING (true);
CREATE POLICY cc_broadcasts_worker_update_race_days ON public.race_days
  FOR UPDATE TO cc_broadcasts_worker USING (true) WITH CHECK (true);
CREATE POLICY cc_broadcasts_worker_read_broadcasts ON public.broadcasts
  FOR SELECT TO cc_broadcasts_worker USING (true);
CREATE POLICY cc_broadcasts_worker_insert_broadcasts ON public.broadcasts
  FOR INSERT TO cc_broadcasts_worker WITH CHECK (true);
CREATE POLICY cc_broadcasts_worker_update_broadcasts ON public.broadcasts
  FOR UPDATE TO cc_broadcasts_worker USING (true) WITH CHECK (true);

-- Provisionado de una sola ejecución. El VPS genera la contraseña, la envía por
-- la conexión TLS existente del watcher y la guarda directamente en su env
-- privado. La función se revoca a sí misma y rechaza cualquier segunda llamada.
CREATE OR REPLACE FUNCTION private.provision_cc_broadcasts_login(p_password text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'private', 'pg_temp'
AS $function$
DECLARE
  already_login boolean;
BEGIN
  IF session_user <> 'cc_results_worker' THEN
    RAISE EXCEPTION 'Rol de provisionado no autorizado' USING ERRCODE = '42501';
  END IF;
  IF length(COALESCE(p_password, '')) < 32 THEN
    RAISE EXCEPTION 'La contraseña generada es demasiado corta' USING ERRCODE = '22023';
  END IF;

  SELECT rolcanlogin INTO already_login
  FROM pg_roles
  WHERE rolname = 'cc_broadcasts_login';
  IF already_login IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'cc_broadcasts_login ya está provisionado' USING ERRCODE = '55000';
  END IF;

  EXECUTE format('ALTER ROLE cc_broadcasts_login LOGIN PASSWORD %L', p_password);
  REVOKE EXECUTE ON FUNCTION private.provision_cc_broadcasts_login(text)
    FROM cc_results_worker;
END;
$function$;

REVOKE ALL ON FUNCTION private.provision_cc_broadcasts_login(text)
  FROM PUBLIC, anon, authenticated, service_role, cc_broadcasts_login;
GRANT EXECUTE ON FUNCTION private.provision_cc_broadcasts_login(text)
  TO cc_results_worker;

COMMENT ON TABLE private.broadcast_source_links IS
  'Vínculo explícito entre una emisión oficial y las filas que puede gestionar el VPS.';
COMMENT ON COLUMN private.broadcast_source_links.manual_lock IS
  'Bloqueo administrativo: impide cualquier actualización automática del vínculo.';
COMMENT ON TABLE private.broadcast_source_observations IS
  'Registro append-only de observaciones, emparejamientos, cambios y snapshots de rollback.';
