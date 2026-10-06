-- aviso_cambio_webs_externas
--
-- Aviso de cambio de CC hacia webs externas que generan sus páginas en un
-- build y leen los datos de CC por la API pública. Primer destino: las webs
-- classicacampdemorvedre.com y clubciclistaestivella.com (proyecto Supabase
-- webs-ccm-cce, edge function aviso-cc). Diseño y operación:
-- docs/runbooks/aviso-cambio-webs-externas.md.
--
-- Flujo:
--   1. Disparadores por sentencia (tablas de transición) en races, race_days,
--      assets, race_uci_stages, race_uci_results, startlist_teams y
--      startlist_riders, y por fila en storage.objects (bucket route-gpx),
--      marcan en private.change_notice_pending las carreras de
--      private.change_notice_races afectadas. Una carga masiva produce una
--      marca por carrera y sentencia, no por fila.
--   2. private.change_notice_tick(), cada minuto por pg_cron, envía un POST
--      con pg_net por carrera pendiente cuando lleva quiet_period sin cambios
--      o max_delay desde el primero, y solo si el destino está activado.
--   3. Cada envío queda en private.change_notice_log; el tick siguiente copia
--      el estado HTTP de net._http_response y reprograma hasta tres intentos
--      si falla.
--
-- Estado al aplicar: destino webs-ccm-cce con enabled = false. La detección
-- marca pendientes, pero no se envía nada hasta activarlo y crear en Vault el
-- secreto compartido (nombre en vault_secret_name). El secreto no figura en el
-- repositorio.
--
-- Contrato del envío: POST <url>, cuerpo {"cc_carrera_id": "<raceId>"},
-- cabeceras Content-Type: application/json y x-aviso-cc-secreto: <secreto>.

-- ── Destinos ────────────────────────────────────────────────────────────────
CREATE TABLE private.change_notice_endpoints (
  id                text        PRIMARY KEY,
  url               text        NOT NULL CHECK (url ~ '^https://'),
  vault_secret_name text        NOT NULL,
  enabled           boolean     NOT NULL DEFAULT false,
  quiet_period      interval    NOT NULL DEFAULT interval '2 minutes',
  max_delay         interval    NOT NULL DEFAULT interval '15 minutes',
  note              text,
  CHECK (quiet_period >= interval '0' AND max_delay >= quiet_period)
);

COMMENT ON TABLE private.change_notice_endpoints IS
  'Destinos del aviso de cambio. enabled = false: se marcan pendientes y no se envía nada. Secreto compartido en Vault con el nombre vault_secret_name.';

-- ── Carreras vigiladas ──────────────────────────────────────────────────────
-- Lista mantenible por SQL (cc_agent). La FK impide vigilar una carrera
-- inexistente y borrar una carrera vigilada sin retirarla antes de la lista.
CREATE TABLE private.change_notice_races (
  endpoint_id text        NOT NULL REFERENCES private.change_notice_endpoints(id),
  race_id     text        NOT NULL REFERENCES public.races(id),
  note        text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (endpoint_id, race_id)
);

CREATE INDEX change_notice_races_race_id_idx ON private.change_notice_races (race_id);

COMMENT ON TABLE private.change_notice_races IS
  'Carreras de CC cuyos cambios se avisan a cada destino de change_notice_endpoints.';

-- ── Pendientes de envío ─────────────────────────────────────────────────────
CREATE TABLE private.change_notice_pending (
  endpoint_id     text        NOT NULL REFERENCES private.change_notice_endpoints(id),
  race_id         text        NOT NULL,
  first_change_at timestamptz NOT NULL DEFAULT now(),
  last_change_at  timestamptz NOT NULL DEFAULT now(),
  attempt         smallint    NOT NULL DEFAULT 1,
  PRIMARY KEY (endpoint_id, race_id)
);

COMMENT ON TABLE private.change_notice_pending IS
  'Una fila por destino y carrera con cambios sin avisar. La escriben los disparadores y la consume change_notice_tick().';

-- ── Registro de envíos ──────────────────────────────────────────────────────
CREATE TABLE private.change_notice_log (
  id              bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  endpoint_id     text        NOT NULL,
  race_id         text        NOT NULL,
  first_change_at timestamptz NOT NULL,
  requested_at    timestamptz NOT NULL DEFAULT now(),
  attempt         smallint    NOT NULL,
  request_id      bigint      NOT NULL,
  checked_at      timestamptz,
  status_code     integer,
  error           text
);

CREATE INDEX change_notice_log_unchecked_idx ON private.change_notice_log (request_id) WHERE checked_at IS NULL;
CREATE INDEX change_notice_log_race_idx ON private.change_notice_log (race_id, requested_at DESC);

COMMENT ON TABLE private.change_notice_log IS
  'Envíos del aviso de cambio con su estado HTTP (de net._http_response). Retención: 180 días.';

ALTER TABLE private.change_notice_endpoints ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.change_notice_races     ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.change_notice_pending   ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.change_notice_log       ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE private.change_notice_endpoints, private.change_notice_races,
  private.change_notice_pending, private.change_notice_log
  FROM PUBLIC, anon, authenticated, service_role;

-- cc_agent mantiene la lista y consulta el estado; activar un destino o
-- cambiar su URL queda para la credencial administradora.
GRANT SELECT ON TABLE private.change_notice_endpoints, private.change_notice_pending,
  private.change_notice_log TO cc_agent;
GRANT SELECT, INSERT, DELETE ON TABLE private.change_notice_races TO cc_agent;
GRANT UPDATE (note) ON TABLE private.change_notice_races TO cc_agent;

-- ── Marca de pendientes ─────────────────────────────────────────────────────
CREATE FUNCTION private.change_notice_mark(p_race_ids text[])
  RETURNS void
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = ''
AS $$
  INSERT INTO private.change_notice_pending AS p (endpoint_id, race_id, first_change_at, last_change_at)
  SELECT w.endpoint_id, w.race_id, now(), now()
    FROM private.change_notice_races w
   WHERE w.race_id = ANY (p_race_ids)
  ON CONFLICT (endpoint_id, race_id)
    DO UPDATE SET last_change_at = GREATEST(p.last_change_at, EXCLUDED.last_change_at),
                  attempt = 1;
$$;

-- ── Disparador por sentencia de las tablas de datos ─────────────────────────
-- TG_ARGV[0]: columna que lleva a la carrera (id en races, raceDayId en
-- assets, raceId en el resto). TG_ARGV[1]: columnas operativas separadas por
-- comas cuyo cambio aislado no se avisa (marcas de sincronización y auditoría).
-- Un error se registra como WARNING y no interrumpe la escritura de CC.
CREATE FUNCTION private.change_notice_rows_trg()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = ''
AS $$
DECLARE
  v_ignore text[] := COALESCE(string_to_array(NULLIF(TG_ARGV[1], ''), ','), '{}');
  v_expr   text;
  v_ids    text[];
BEGIN
  IF NOT EXISTS (SELECT 1 FROM private.change_notice_races) THEN
    RETURN NULL;
  END IF;

  BEGIN
    v_expr := CASE TG_ARGV[0]
      WHEN 'raceDayId' THEN '(SELECT d."raceId" FROM public.race_days d WHERE d.id = {t}."raceDayId")'
      ELSE '{t}.' || quote_ident(TG_ARGV[0])
    END;

    IF TG_OP = 'INSERT' THEN
      EXECUTE format(
        'SELECT array_agg(DISTINCT r) FROM (SELECT %s AS r FROM nuevas n) s
          WHERE r IN (SELECT race_id FROM private.change_notice_races)',
        replace(v_expr, '{t}', 'n'))
      INTO v_ids;
    ELSIF TG_OP = 'DELETE' THEN
      EXECUTE format(
        'SELECT array_agg(DISTINCT r) FROM (SELECT %s AS r FROM viejas o) s
          WHERE r IN (SELECT race_id FROM private.change_notice_races)',
        replace(v_expr, '{t}', 'o'))
      INTO v_ids;
    ELSE
      EXECUTE format(
        'SELECT array_agg(DISTINCT r)
           FROM (SELECT %s AS rn, %s AS ro, to_jsonb(n) - $1 AS jn, to_jsonb(o) - $1 AS jo
                   FROM nuevas n JOIN viejas o ON o.id = n.id) s
           CROSS JOIN LATERAL unnest(ARRAY[rn, ro]) AS r
          WHERE r IN (SELECT race_id FROM private.change_notice_races)
            AND jn IS DISTINCT FROM jo',
        replace(v_expr, '{t}', 'n'), replace(v_expr, '{t}', 'o'))
      INTO v_ids USING v_ignore;
    END IF;

    IF v_ids IS NOT NULL THEN
      PERFORM private.change_notice_mark(v_ids);
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'change_notice_rows_trg (%, %): %', TG_TABLE_NAME, TG_OP, SQLERRM;
  END;
  RETURN NULL;
END;
$$;

-- ── Disparador por fila del bucket route-gpx ────────────────────────────────
-- Objetos route-<raceDayId>.gpx (js/panel/jornada-profile.js y cc-assets).
CREATE FUNCTION private.change_notice_route_gpx_trg()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = ''
AS $$
DECLARE
  v_names text[];
  v_ids   text[];
BEGIN
  IF NOT EXISTS (SELECT 1 FROM private.change_notice_races) THEN
    RETURN NULL;
  END IF;

  BEGIN
    v_names := CASE TG_OP
      WHEN 'INSERT' THEN ARRAY[NEW.name]
      WHEN 'DELETE' THEN ARRAY[OLD.name]
      ELSE ARRAY[NEW.name, OLD.name]
    END;

    SELECT array_agg(DISTINCT d."raceId") INTO v_ids
      FROM unnest(v_names) AS f(name)
      JOIN public.race_days d ON d.id = substring(f.name FROM '^route-(.+)\.gpx$');

    IF v_ids IS NOT NULL THEN
      PERFORM private.change_notice_mark(v_ids);
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'change_notice_route_gpx_trg (%): %', TG_OP, SQLERRM;
  END;
  RETURN NULL;
END;
$$;

-- ── Envío agrupado (pg_cron, cada minuto) ───────────────────────────────────
CREATE FUNCTION private.change_notice_tick()
  RETURNS integer
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = ''
AS $$
DECLARE
  MAX_ATTEMPTS constant smallint := 3;
  r        record;
  v_secret text;
  v_req    bigint;
  v_sent   integer := 0;
BEGIN
  -- 1. Estado de los envíos anteriores y reintento de los fallidos.
  WITH resolved AS (
    UPDATE private.change_notice_log l
       SET checked_at  = now(),
           status_code = h.status_code,
           error       = COALESCE(h.error_msg, CASE WHEN h.timed_out THEN 'timeout' END)
      FROM net._http_response h
     WHERE l.checked_at IS NULL AND h.id = l.request_id
    RETURNING l.endpoint_id, l.race_id, l.first_change_at, l.attempt, l.status_code
  ), lost AS (
    UPDATE private.change_notice_log l
       SET checked_at = now(), error = 'sin respuesta de pg_net'
     WHERE l.checked_at IS NULL AND l.requested_at < now() - interval '1 hour'
       AND NOT EXISTS (SELECT 1 FROM net._http_response h WHERE h.id = l.request_id)
    RETURNING l.endpoint_id, l.race_id, l.first_change_at, l.attempt, NULL::integer AS status_code
  )
  INSERT INTO private.change_notice_pending (endpoint_id, race_id, first_change_at, last_change_at, attempt)
  SELECT f.endpoint_id, f.race_id, f.first_change_at, now(), f.attempt + 1
    FROM (SELECT * FROM resolved UNION ALL SELECT * FROM lost) f
   WHERE (f.status_code IS NULL OR f.status_code NOT BETWEEN 200 AND 299)
     AND f.attempt < MAX_ATTEMPTS
  ON CONFLICT (endpoint_id, race_id) DO NOTHING;

  -- 2. Envío de las carreras con el periodo de espera cumplido.
  FOR r IN
    SELECT p.endpoint_id, p.race_id, p.first_change_at, p.attempt, e.url, e.vault_secret_name
      FROM private.change_notice_pending p
      JOIN private.change_notice_endpoints e ON e.id = p.endpoint_id
     WHERE e.enabled
       AND (p.last_change_at <= now() - e.quiet_period
            OR p.first_change_at <= now() - e.max_delay)
     ORDER BY p.first_change_at
     FOR UPDATE OF p SKIP LOCKED
  LOOP
    SELECT s.decrypted_secret INTO v_secret
      FROM vault.decrypted_secrets s
     WHERE s.name = r.vault_secret_name
     LIMIT 1;

    IF v_secret IS NULL OR btrim(v_secret) = '' THEN
      RAISE WARNING 'change_notice_tick: falta el secreto de Vault "%" (destino %)',
        r.vault_secret_name, r.endpoint_id;
      CONTINUE;
    END IF;

    v_req := net.http_post(
      url := r.url,
      body := jsonb_build_object('cc_carrera_id', r.race_id),
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-aviso-cc-secreto', v_secret),
      timeout_milliseconds := 10000
    );

    INSERT INTO private.change_notice_log (endpoint_id, race_id, first_change_at, attempt, request_id)
    VALUES (r.endpoint_id, r.race_id, r.first_change_at, r.attempt, v_req);

    DELETE FROM private.change_notice_pending
     WHERE endpoint_id = r.endpoint_id AND race_id = r.race_id;

    v_sent := v_sent + 1;
  END LOOP;

  -- 3. Retención del registro.
  DELETE FROM private.change_notice_log WHERE requested_at < now() - interval '180 days';

  RETURN v_sent;
END;
$$;

REVOKE ALL ON FUNCTION private.change_notice_mark(text[]), private.change_notice_rows_trg(),
  private.change_notice_route_gpx_trg(), private.change_notice_tick()
  FROM PUBLIC, anon, authenticated, service_role;

-- ── Disparadores ────────────────────────────────────────────────────────────
-- Las tablas de transición exigen un disparador por evento.
CREATE TRIGGER change_notice_ins AFTER INSERT ON public.races
  REFERENCING NEW TABLE AS nuevas FOR EACH STATEMENT EXECUTE FUNCTION private.change_notice_rows_trg('id', '');
CREATE TRIGGER change_notice_upd AFTER UPDATE ON public.races
  REFERENCING OLD TABLE AS viejas NEW TABLE AS nuevas FOR EACH STATEMENT EXECUTE FUNCTION private.change_notice_rows_trg('id', '');
CREATE TRIGGER change_notice_del AFTER DELETE ON public.races
  REFERENCING OLD TABLE AS viejas FOR EACH STATEMENT EXECUTE FUNCTION private.change_notice_rows_trg('id', '');

CREATE TRIGGER change_notice_ins AFTER INSERT ON public.race_days
  REFERENCING NEW TABLE AS nuevas FOR EACH STATEMENT EXECUTE FUNCTION private.change_notice_rows_trg('raceId', '');
CREATE TRIGGER change_notice_upd AFTER UPDATE ON public.race_days
  REFERENCING OLD TABLE AS viejas NEW TABLE AS nuevas FOR EACH STATEMENT EXECUTE FUNCTION private.change_notice_rows_trg('raceId',
    'updatedAt,dismissedWarnings,resultsAutoSyncEnabled,resultsSyncStartOffsetMinutes,resultsSyncIntervalMinutes,resultsSyncStopOffsetMinutes,resultsLastAutoSyncAt,resultsAutoSyncQueuedAt,resultsSyncStartAt,resultsSyncStopAt,metricsUpdatedAt');
CREATE TRIGGER change_notice_del AFTER DELETE ON public.race_days
  REFERENCING OLD TABLE AS viejas FOR EACH STATEMENT EXECUTE FUNCTION private.change_notice_rows_trg('raceId', '');

CREATE TRIGGER change_notice_ins AFTER INSERT ON public.assets
  REFERENCING NEW TABLE AS nuevas FOR EACH STATEMENT EXECUTE FUNCTION private.change_notice_rows_trg('raceDayId', '');
CREATE TRIGGER change_notice_upd AFTER UPDATE ON public.assets
  REFERENCING OLD TABLE AS viejas NEW TABLE AS nuevas FOR EACH STATEMENT EXECUTE FUNCTION private.change_notice_rows_trg('raceDayId', '');
CREATE TRIGGER change_notice_del AFTER DELETE ON public.assets
  REFERENCING OLD TABLE AS viejas FOR EACH STATEMENT EXECUTE FUNCTION private.change_notice_rows_trg('raceDayId', '');

CREATE TRIGGER change_notice_ins AFTER INSERT ON public.race_uci_stages
  REFERENCING NEW TABLE AS nuevas FOR EACH STATEMENT EXECUTE FUNCTION private.change_notice_rows_trg('raceId', '');
CREATE TRIGGER change_notice_upd AFTER UPDATE ON public.race_uci_stages
  REFERENCING OLD TABLE AS viejas NEW TABLE AS nuevas FOR EACH STATEMENT EXECUTE FUNCTION private.change_notice_rows_trg('raceId',
    'updatedAt,lastSyncedAt,updating,updatingUntil');
CREATE TRIGGER change_notice_del AFTER DELETE ON public.race_uci_stages
  REFERENCING OLD TABLE AS viejas FOR EACH STATEMENT EXECUTE FUNCTION private.change_notice_rows_trg('raceId', '');

CREATE TRIGGER change_notice_ins AFTER INSERT ON public.race_uci_results
  REFERENCING NEW TABLE AS nuevas FOR EACH STATEMENT EXECUTE FUNCTION private.change_notice_rows_trg('raceId', '');
CREATE TRIGGER change_notice_upd AFTER UPDATE ON public.race_uci_results
  REFERENCING OLD TABLE AS viejas NEW TABLE AS nuevas FOR EACH STATEMENT EXECUTE FUNCTION private.change_notice_rows_trg('raceId', '');
CREATE TRIGGER change_notice_del AFTER DELETE ON public.race_uci_results
  REFERENCING OLD TABLE AS viejas FOR EACH STATEMENT EXECUTE FUNCTION private.change_notice_rows_trg('raceId', '');

CREATE TRIGGER change_notice_ins AFTER INSERT ON public.startlist_teams
  REFERENCING NEW TABLE AS nuevas FOR EACH STATEMENT EXECUTE FUNCTION private.change_notice_rows_trg('raceId', '');
CREATE TRIGGER change_notice_upd AFTER UPDATE ON public.startlist_teams
  REFERENCING OLD TABLE AS viejas NEW TABLE AS nuevas FOR EACH STATEMENT EXECUTE FUNCTION private.change_notice_rows_trg('raceId', '');
CREATE TRIGGER change_notice_del AFTER DELETE ON public.startlist_teams
  REFERENCING OLD TABLE AS viejas FOR EACH STATEMENT EXECUTE FUNCTION private.change_notice_rows_trg('raceId', '');

CREATE TRIGGER change_notice_ins AFTER INSERT ON public.startlist_riders
  REFERENCING NEW TABLE AS nuevas FOR EACH STATEMENT EXECUTE FUNCTION private.change_notice_rows_trg('raceId', '');
CREATE TRIGGER change_notice_upd AFTER UPDATE ON public.startlist_riders
  REFERENCING OLD TABLE AS viejas NEW TABLE AS nuevas FOR EACH STATEMENT EXECUTE FUNCTION private.change_notice_rows_trg('raceId', '');
CREATE TRIGGER change_notice_del AFTER DELETE ON public.startlist_riders
  REFERENCING OLD TABLE AS viejas FOR EACH STATEMENT EXECUTE FUNCTION private.change_notice_rows_trg('raceId', '');

CREATE TRIGGER change_notice_route_gpx_ins AFTER INSERT ON storage.objects
  FOR EACH ROW WHEN (NEW.bucket_id = 'route-gpx')
  EXECUTE FUNCTION private.change_notice_route_gpx_trg();
CREATE TRIGGER change_notice_route_gpx_upd AFTER UPDATE ON storage.objects
  FOR EACH ROW WHEN (NEW.bucket_id = 'route-gpx' OR OLD.bucket_id = 'route-gpx')
  EXECUTE FUNCTION private.change_notice_route_gpx_trg();
CREATE TRIGGER change_notice_route_gpx_del AFTER DELETE ON storage.objects
  FOR EACH ROW WHEN (OLD.bucket_id = 'route-gpx')
  EXECUTE FUNCTION private.change_notice_route_gpx_trg();

-- ── Datos iniciales (envío desactivado) ─────────────────────────────────────
INSERT INTO private.change_notice_endpoints (id, url, vault_secret_name, enabled, note)
VALUES ('webs-ccm-cce',
        'https://fybnlsxnqmpsliehiuih.supabase.co/functions/v1/aviso-cc',
        'aviso_cc_webs_ccm_cce',
        false,
        'classicacampdemorvedre.com y clubciclistaestivella.com (proyecto webs-ccm-cce); llama a webs.aviso_cc(cc_carrera_id)');

INSERT INTO private.change_notice_races (endpoint_id, race_id, note) VALUES
  ('webs-ccm-cce', 'FoJNjtj1ex8AemXhlGmo', 'Clàssica Camp de Morvedre 2026'),
  ('webs-ccm-cce', '6e08f4f2-2d37-4093-9929-d1df1e82e627', 'Clàssica Camp de Morvedre 2025');

SELECT cron.schedule('change-notice-tick', '* * * * *', 'SELECT private.change_notice_tick();');
