-- El historial visible sigue limitado a diez ejecuciones globales. Además se
-- conserva la última de cada trabajo para que una cadencia rápida (resultados)
-- no vacíe las tarjetas de fuentes de una cadencia más lenta (emisiones).

CREATE OR REPLACE FUNCTION private.finish_automation_run(
  p_run_id bigint,
  p_status text,
  p_summary jsonb DEFAULT '{}'::jsonb,
  p_error text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_job text;
BEGIN
  SELECT job INTO v_job FROM private.automation_runs WHERE id = p_run_id;
  IF (session_user = 'cc_results_worker' AND v_job NOT IN ('results', 'uci_team_ranking'))
     OR (session_user = 'cc_broadcasts_login' AND v_job <> 'broadcasts')
     OR session_user NOT IN ('cc_results_worker', 'cc_broadcasts_login') THEN
    RAISE EXCEPTION 'Ejecución no autorizada para este worker' USING ERRCODE = '42501';
  END IF;

  UPDATE private.automation_runs
  SET finished_at = now(),
      status = p_status,
      summary = COALESCE(p_summary, '{}'::jsonb),
      error_message = CASE WHEN p_status IN ('error', 'partial')
        THEN left(COALESCE(p_error, 'Error sin detalle'), 2000)
        ELSE NULL
      END
  WHERE id = p_run_id
    AND status = 'running';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ejecución no activa: %', p_run_id;
  END IF;

  DELETE FROM private.automation_runs r
  WHERE r.status <> 'running'
    AND r.id NOT IN (
      SELECT recent.id
      FROM private.automation_runs recent
      ORDER BY recent.started_at DESC, recent.id DESC
      LIMIT 10
    )
    AND r.id NOT IN (
      SELECT DISTINCT ON (latest.job) latest.id
      FROM private.automation_runs latest
      ORDER BY latest.job, latest.started_at DESC, latest.id DESC
    );
END;
$function$;

REVOKE ALL ON FUNCTION private.finish_automation_run(bigint, text, jsonb, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.finish_automation_run(bigint, text, jsonb, text)
  TO cc_results_worker, cc_broadcasts_worker;

COMMENT ON FUNCTION private.finish_automation_run(bigint, text, jsonb, text) IS
  'Cierra una ejecución y conserva las diez más recientes más la última instantánea de cada trabajo.';
