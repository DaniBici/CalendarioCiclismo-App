-- 134 — Volcado de resultados UCI dirigido a UNA etapa.
--
-- El botón "Volcar esta carrera" del panel dispara el workflow con race_id, que
-- re-vuelca la carrera ENTERA (todas las etapas). En una grande (Tour, 21 etapas)
-- eso re-escribe todas las clasificaciones ya asentadas para tocar una sola etapa:
-- minutos de trabajo y de contención de Postgres para nada.
--
-- Esta migración añade una sobrecarga de admin_trigger_uci_results_workflow que acepta
-- el nº de etapa (p_stage). Cuando se pasa, el workflow recibe el input stage_number y
-- el cron re-escribe SOLO esa etapa (--stage → --only-stage en el upsert). La sobrecarga
-- (text) existente se reescribe para delegar en la nueva con p_stage = NULL (= carrera
-- entera), preservando su comportamiento actual sin duplicar el cuerpo.
--
-- Grants: iguales a las sobrecargas existentes (authenticated + service_role EXECUTE).

CREATE OR REPLACE FUNCTION public.admin_trigger_uci_results_workflow(
  p_race_id text,
  p_stage   integer
)
  RETURNS text
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_token   text;
  v_owner   text := 'DaniBici';
  v_repo    text := 'calendario-ciclismo';
  v_wf      text := 'uci-results-today.yml';
  v_inputs  jsonb;
BEGIN
  IF p_race_id IS NULL OR btrim(p_race_id) = '' THEN
    RAISE EXCEPTION 'Falta p_race_id';
  END IF;

  SELECT decrypted_secret INTO v_token
  FROM vault.decrypted_secrets
  WHERE name = 'github_dispatch_token'
  LIMIT 1;

  IF v_token IS NULL OR btrim(v_token) = '' THEN
    RAISE EXCEPTION 'Falta el secret de Vault "github_dispatch_token"';
  END IF;

  -- La API de GitHub exige los inputs como strings (también los numéricos). stage_number
  -- solo se manda si p_stage no es NULL → sin etapa, el workflow vuelca la carrera entera.
  v_inputs := jsonb_build_object('race_id', p_race_id);
  IF p_stage IS NOT NULL THEN
    v_inputs := v_inputs || jsonb_build_object('stage_number', p_stage::text);
  END IF;

  PERFORM net.http_post(
    url := format('https://api.github.com/repos/%s/%s/actions/workflows/%s/dispatches',
                  v_owner, v_repo, v_wf),
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || v_token,
      'Accept', 'application/vnd.github+json',
      'X-GitHub-Api-Version', '2022-11-28',
      'User-Agent', 'supabase-panel-admin',
      'Content-Type', 'application/json'
    ),
    body := jsonb_build_object(
      'ref', 'main',
      'inputs', v_inputs
    ),
    timeout_milliseconds := 15000
  );

  RETURN 'dispatched';
END;
$function$;

-- La sobrecarga (text) existente pasa a delegar en la nueva con p_stage = NULL
-- (comportamiento idéntico al anterior: carrera entera).
CREATE OR REPLACE FUNCTION public.admin_trigger_uci_results_workflow(p_race_id text)
  RETURNS text
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  RETURN public.admin_trigger_uci_results_workflow(p_race_id, NULL::integer);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.admin_trigger_uci_results_workflow(text, integer)
  TO authenticated, service_role;
