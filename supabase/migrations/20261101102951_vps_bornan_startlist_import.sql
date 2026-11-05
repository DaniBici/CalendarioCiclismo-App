-- Envoltura del VPS para los inscritos de los Juegos servidos por Bornan.
--
-- bornan-startlists-sync.mjs llamaba directamente a prepare_startlist_import y
-- apply_startlist_import. 20260918200000_assert_startlist_import_vps.sql retiró
-- a cc_results_worker el EXECUTE directo de ambas para que el worker solo entrara
-- por una envoltura; desde entonces el sincronizador del VPS no podía aplicar
-- ninguna lista. Esta función solo admite carreras enlazadas con
-- race_uci_links.source='bornan', conserva la marca provisional y las
-- correcciones que pasa el sincronizador y devuelve los informes de las dos RPC.
-- cc_agent la necesita para las ejecuciones locales del mismo script.

CREATE FUNCTION public.vps_import_bornan_startlist(
  p_race_id text,
  p_document jsonb,
  p_provisional boolean,
  p_overrides jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_prepared  jsonb;
  v_import_id uuid;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.race_uci_links l
     WHERE l."raceId" = p_race_id AND l.source = 'bornan'
  ) THEN
    RAISE EXCEPTION 'vps_import_bornan_startlist: la carrera % no está enlazada a Bornan', p_race_id
      USING ERRCODE = '42501';
  END IF;

  v_prepared := public.prepare_startlist_import(p_race_id, p_document, p_provisional);
  v_import_id := nullif(v_prepared->>'importId', '')::uuid;
  IF v_import_id IS NULL THEN
    RETURN jsonb_build_object('prepared', v_prepared, 'applied', '{}'::jsonb);
  END IF;

  RETURN jsonb_build_object(
    'prepared', v_prepared,
    'applied', public.apply_startlist_import(v_import_id, coalesce(p_overrides, '{}'::jsonb))
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.vps_import_bornan_startlist(text, jsonb, boolean, jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.vps_import_bornan_startlist(text, jsonb, boolean, jsonb)
  TO cc_results_worker, cc_agent;
