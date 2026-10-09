-- Catálogo UCI: el contexto del planificador incluye otherNames de cada ficha.
-- El planificador acepta como mismo nombre un alias exacto de la ficha; el cambio solo añade una clave
-- al JSON de riders y no altera propietario, permisos ni firma.
CREATE OR REPLACE FUNCTION private.uci_catalog_context(p_run uuid, p_token uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
      SELECT id,'male' AS gender,"firstName","lastName","otherNames",nationality,"birthDate","uciProfileId","currentTeamId","contractUntil" FROM public.riders_men
      UNION ALL SELECT id,'female',"firstName","lastName","otherNames",nationality,"birthDate","uciProfileId","currentTeamId","contractUntil" FROM public.riders_women
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
$function$;
