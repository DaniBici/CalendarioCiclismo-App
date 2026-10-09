-- Catálogo UCI: cierre automático de casos cuya condición ya no se detecta.
--
-- Los motivos de la lista se recalculan íntegros en cada plan. Un caso abierto
-- de esos motivos cuya clave no figura en el plan de una ejecución terminada
-- ha dejado de cumplirse (ficha corregida, biografía coincidente, equipo
-- enlazado o perfil retirado de la fuente) y se resuelve con su decisión.
-- No se tocan `source_absence` y `source_roster_drop`, que solo se emiten el
-- día del cambio, ni los casos `locked`, `awaiting_stability`, `manual_lock`
-- o `change_budget_exceeded`, ni los de otras temporadas, ni las claves
-- `:prepare` generadas por la validación SQL.
-- Sin objetos nuevos: la función conserva propietario, `SECURITY DEFINER` y
-- privilegios; no requiere `GRANT`.

CREATE OR REPLACE FUNCTION private.uci_catalog_stage(p_run uuid, p_token uuid, p_plan jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v_item jsonb; v_reason text; v_limit integer; v_new_cases integer:=0; v_count integer; v_rejected integer:=0; v_year text; v_closed integer:=0;
BEGIN
  PERFORM private.uci_catalog_lease(p_run,p_token);
  IF EXISTS(SELECT 1 FROM private.uci_catalog_runs WHERE id=p_run AND plan IS NOT NULL) THEN
    RETURN (SELECT COALESCE(jsonb_agg(jsonb_build_object('id',id,'status',status)),'[]'::jsonb)
      FROM private.uci_catalog_changes WHERE run_id=p_run);
  END IF;
  IF octet_length(p_plan::text)>4000000 OR p_plan->>'version' IS DISTINCT FROM '1'
    OR jsonb_typeof(p_plan->'actions') IS DISTINCT FROM 'array' OR jsonb_typeof(p_plan->'cases') IS DISTINCT FROM 'array'
    OR jsonb_array_length(p_plan->'cases')>10000 THEN RAISE EXCEPTION 'invalid_plan'; END IF;
  SELECT least(50,greatest(1,floor(count(*)*.02)::integer)) INTO v_limit FROM private.uci_catalog_runs r,
    LATERAL jsonb_object_keys(r.snapshot->'records') k WHERE r.id=p_run;
  SELECT snapshot->>'year' INTO v_year FROM private.uci_catalog_runs WHERE id=p_run;
  IF jsonb_array_length(p_plan->'actions')>v_limit THEN RAISE EXCEPTION 'change_budget_exceeded'; END IF;
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_plan->'cases') LOOP
    INSERT INTO private.uci_catalog_cases(key,reason,detail)
      VALUES(v_item->>'key',v_item->>'reason',COALESCE(v_item->'detail','{}'::jsonb))
      ON CONFLICT DO NOTHING;
    GET DIAGNOSTICS v_count=ROW_COUNT; v_new_cases:=v_new_cases+v_count;
    UPDATE private.uci_catalog_cases SET last_seen=clock_timestamp(),reason=v_item->>'reason',detail=COALESCE(v_item->'detail','{}'::jsonb)
      WHERE key=v_item->>'key' AND status='open';
  END LOOP;
  WITH closed AS (
    UPDATE private.uci_catalog_cases c SET status='resolved',
      decision='Cierre automático: la condición ya no figura en el plan del run '||p_run||'.'
    WHERE c.status='open'
      AND c.reason IN ('biography_review','team_catalog_review','source_identity_conflict','identity_unresolved','identity_conflict',
        'multiple_regular_teams','baseline_conflict','initial_affiliation_review','season_transition_review',
        'affiliation_or_contract_review','source_history_conflict','trainee_review')
      AND (c.key LIKE 'rider:'||v_year||':%' OR c.key LIKE 'team:'||v_year||':%')
      AND c.key NOT LIKE '%:prepare'
      AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(p_plan->'cases') x WHERE x->>'key'=c.key)
    RETURNING c.key,c.decision),
  logged AS (INSERT INTO private.uci_catalog_decisions(case_key,decision,status)
    SELECT key,decision,'resolved' FROM closed RETURNING 1)
  SELECT count(*) INTO v_closed FROM logged;
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_plan->'actions') LOOP
    v_reason:=private.uci_catalog_check(p_run,v_item);
    IF v_reason IS NOT NULL THEN
      v_rejected:=v_rejected+1;
      INSERT INTO private.uci_catalog_cases(key,reason,detail)
        VALUES('rider:'||v_year||':'||(v_item->>'profile')||':prepare',v_reason,v_item)
        ON CONFLICT(key) DO UPDATE SET last_seen=clock_timestamp(),reason=EXCLUDED.reason,detail=EXCLUDED.detail
          WHERE private.uci_catalog_cases.status='open';
      CONTINUE;
    END IF;
    INSERT INTO private.uci_catalog_changes(run_id,profile,rider_id,gender,operations,expected_hash)
      VALUES(p_run,v_item->>'profile',v_item->>'riderId',v_item->>'gender',v_item->'operations',v_item->>'expectedHash');
  END LOOP;
  UPDATE private.uci_catalog_runs SET plan=p_plan,summary=jsonb_build_object('newCases',v_new_cases,'rejected',v_rejected,'proposed',p_plan->'proposed','closedCases',v_closed) WHERE id=p_run;
  RETURN (SELECT COALESCE(jsonb_agg(jsonb_build_object('id',id,'status',status)),'[]'::jsonb) FROM private.uci_catalog_changes WHERE run_id=p_run);
END;
$function$;
