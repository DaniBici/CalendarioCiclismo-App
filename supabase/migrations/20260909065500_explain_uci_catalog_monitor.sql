BEGIN;

CREATE OR REPLACE FUNCTION private.get_automation_monitor() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path='' AS $$
DECLARE v_result jsonb; v_runs jsonb;
BEGIN
  IF NOT COALESCE(private.is_admin(),false) THEN RAISE EXCEPTION 'admin_required' USING ERRCODE='42501'; END IF;
  v_result:=private.get_automation_monitor_before_uci_catalog();
  SELECT COALESCE(jsonb_agg(item ORDER BY item->>'startedAt' DESC),'[]'::jsonb) INTO v_runs FROM (
    SELECT item FROM jsonb_array_elements(v_result->'runs') item
    UNION ALL SELECT jsonb_build_object('id',id,'job','uci_catalog','triggerKind',mode,'revision',revision,
      'startedAt',started_at,'finishedAt',finished_at,'status',CASE WHEN status='running' AND started_at<now()-interval '130 minutes' THEN 'error' ELSE status END,
      'summary',summary,'errorMessage',CASE WHEN status='running' AND started_at<now()-interval '130 minutes' THEN 'Ejecución interrumpida' ELSE error_code END)
      FROM (SELECT * FROM private.uci_catalog_runs ORDER BY started_at DESC LIMIT 20) r
  ) all_runs;
  RETURN v_result||jsonb_build_object('runs',v_runs,'uciCatalog',jsonb_build_object(
    'enabled',(SELECT enabled FROM private.uci_catalog_control WHERE singleton),
    'lastObservation',(SELECT max(observed_at) FROM private.uci_catalog_runs),
    'overdue',COALESCE((SELECT max(observed_at)<now()-interval '36 hours' FROM private.uci_catalog_runs),false),
    'openCases',(SELECT count(*) FROM private.uci_catalog_cases WHERE status='open'),
    'lockedCases',(SELECT count(*) FROM private.uci_catalog_cases WHERE status='locked'),
    'caseBreakdown',jsonb_build_object(
      'biographyReview',(SELECT count(*) FROM private.uci_catalog_cases WHERE status='open' AND reason='biography_review'),
      'teamsToReview',(SELECT count(*) FROM private.uci_catalog_cases WHERE status='open' AND reason='team_catalog_review' AND key LIKE 'team:%'),
      'ridersWaitingForTeam',(SELECT count(*) FROM private.uci_catalog_cases WHERE status='open' AND reason='team_catalog_review' AND key LIKE 'rider:%'),
      'sourceIdentityConflict',(SELECT count(*) FROM private.uci_catalog_cases WHERE status='open' AND reason='source_identity_conflict'),
      'multipleRegularTeams',(SELECT count(*) FROM private.uci_catalog_cases WHERE status='open' AND reason='multiple_regular_teams'),
      'otherOpen',(SELECT count(*) FROM private.uci_catalog_cases WHERE status='open' AND reason NOT IN (
        'biography_review','team_catalog_review','source_identity_conflict','multiple_regular_teams')),
      'resolved',(SELECT count(*) FROM private.uci_catalog_cases WHERE status='resolved')
    )));
END;
$$;

REVOKE ALL ON FUNCTION private.get_automation_monitor() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.get_automation_monitor() TO authenticated;

COMMIT;
