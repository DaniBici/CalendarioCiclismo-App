-- Excluye de forma persistente los perfiles que la fuente UCI coloca en un
-- panel de corredores aunque correspondan a personal técnico.
BEGIN;

CREATE TABLE private.uci_catalog_rider_exclusions (
  season integer NOT NULL CHECK (season BETWEEN 2005 AND 2100),
  profile text NOT NULL CHECK (profile ~ '^[0-9]{1,10}$'),
  reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 5 AND 1000),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (season, profile)
);

INSERT INTO private.uci_catalog_rider_exclusions(season, profile, reason)
VALUES (2026, '1610729',
  'Personal técnico de L39ION OF LOS ANGELES clasificado incorrectamente por la fuente dentro del panel Riders. Exclusión aprobada el 05/09/2026.');

REVOKE ALL ON TABLE private.uci_catalog_rider_exclusions
  FROM PUBLIC, anon, authenticated, service_role, cc_uci_catalog_worker;
GRANT SELECT ON TABLE private.uci_catalog_rider_exclusions
  TO cc_uci_catalog_owner;

-- La función existente pertenece al rol sin login. Se concede CREATE solo
-- durante esta transacción para reemplazarla bajo su misma autoridad.
GRANT CREATE ON SCHEMA private TO cc_uci_catalog_owner;
SET LOCAL ROLE cc_uci_catalog_owner;

CREATE OR REPLACE FUNCTION private.uci_catalog_context(p_run uuid,p_token uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_run private.uci_catalog_runs; v_year integer; v_result jsonb;
BEGIN
  PERFORM private.uci_catalog_lease(p_run,p_token);
  SELECT * INTO STRICT v_run FROM private.uci_catalog_runs WHERE id=p_run AND snapshot IS NOT NULL;
  v_year:=(v_run.snapshot->>'year')::integer;
  SELECT jsonb_build_object('year',v_year,'observedAt',v_run.observed_at,
    'previous',(SELECT jsonb_build_object('observedAt',observed_at,'snapshot',snapshot)
      FROM private.uci_catalog_runs WHERE id<>p_run AND snapshot IS NOT NULL AND observed_at<v_run.observed_at
        AND (snapshot->>'year')::integer=v_year ORDER BY observed_at DESC LIMIT 1),
    'links',COALESCE((SELECT jsonb_agg(jsonb_build_object('profile',l.profile,'teamId',l.team_id,'gender',l.gender,
      'category',l.category,'sourceName',l.source_name,'sourceCode',l.source_code,'currentCategory',t.category,
      'specialEdition',t."specialEdition",'teamKind',t."teamKind"))
      FROM private.uci_catalog_team_links l JOIN public.teams t ON t.id=l.team_id WHERE l.season=v_year),'[]'::jsonb),
    'riders',(SELECT jsonb_agg(r) FROM (
      SELECT id,'male' AS gender,"firstName","lastName",nationality,"birthDate","uciProfileId","currentTeamId","contractUntil" FROM public.riders_men
      UNION ALL SELECT id,'female',"firstName","lastName",nationality,"birthDate","uciProfileId","currentTeamId","contractUntil" FROM public.riders_women
    ) r),
    'states',COALESCE((SELECT jsonb_object_agg(r.gender||':'||r.id,jsonb_build_object('hash',md5(s.state::text),'affiliations',s.state->'affiliations'))
      FROM (SELECT id,'male' AS gender,"uciProfileId" AS profile FROM public.riders_men
        UNION ALL SELECT id,'female',"uciProfileId" FROM public.riders_women) r
      CROSS JOIN LATERAL(SELECT private.uci_catalog_state(r.id,r.gender) AS state) s
      WHERE v_run.snapshot->'records' ? r.profile),'{}'::jsonb),
    'baselines',COALESCE((SELECT jsonb_object_agg(gender||':'||profile,team_id) FROM private.uci_catalog_baselines WHERE season=v_year),'{}'::jsonb),
    'blocked',COALESCE((SELECT jsonb_agg(key) FROM private.uci_catalog_cases WHERE status='locked'),'[]'::jsonb),
    'exclusions',COALESCE((SELECT jsonb_agg(profile ORDER BY profile)
      FROM private.uci_catalog_rider_exclusions WHERE season=v_year),'[]'::jsonb)) INTO v_result;
  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION private.uci_catalog_context(uuid,uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.uci_catalog_context(uuid,uuid)
  TO cc_uci_catalog_worker;

-- El caso deja de existir en el panel. La exclusión tipada anterior es su
-- sustituto operativo y evita que se regenere en ejecuciones posteriores.
DELETE FROM private.uci_catalog_decisions
WHERE case_key = 'rider:2026:1610729';

DELETE FROM private.uci_catalog_cases
WHERE key = 'rider:2026:1610729';

RESET ROLE;
REVOKE CREATE ON SCHEMA private FROM cc_uci_catalog_owner;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM private.uci_catalog_rider_exclusions
    WHERE season = 2026 AND profile = '1610729'
  ) OR EXISTS (
    SELECT 1 FROM private.uci_catalog_cases
    WHERE key = 'rider:2026:1610729'
  ) THEN
    RAISE EXCEPTION 'uci_staff_exclusion_postcondition_failed';
  END IF;
END;
$$;

COMMIT;
