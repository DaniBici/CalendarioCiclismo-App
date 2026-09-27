-- Edición administrativa de temporadas y plantillas de equipo.
-- Contrato aditivo: encapsula las escrituras que antes hacía el panel sobre
-- team_seasons y rider_team_affiliations sin retirar tablas ni RPC existentes.
BEGIN;

CREATE OR REPLACE FUNCTION public.admin_save_team_season(
  p_team_id text,
  p_year integer,
  p_season jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_team public.teams%ROWTYPE;
  v_row public.team_seasons%ROWTYPE;
  v_name text := btrim(COALESCE(p_season->>'name', ''));
  v_aliases text := NULLIF(btrim(p_season->>'nameAliases'), '');
  v_category text := NULLIF(p_season->>'category', '');
  v_gender text := NULLIF(p_season->>'gender', '');
  v_uci_code text := NULLIF(upper(btrim(p_season->>'uciCode')), '');
  v_header_bg text := lower(COALESCE(NULLIF(p_season->>'headerBg', ''), '#1f2937'));
  v_header_text text := lower(COALESCE(NULLIF(p_season->>'headerText', ''), '#ffffff'));
  v_torso_center text := lower(COALESCE(NULLIF(p_season->>'badgeTorsoCenter', ''), '#ffffff'));
  v_torso_sides text := lower(COALESCE(NULLIF(p_season->>'badgeTorsoSides', ''), '#000000'));
  v_inner_circle text := NULLIF(lower(p_season->>'badgeInnerCircle'), '');
  v_shorts text := lower(COALESCE(NULLIF(p_season->>'badgeShorts', ''), '#000000'));
  v_translations jsonb := COALESCE(p_season->'translations', '{}'::jsonb);
BEGIN
  PERFORM private.assert_startlist_import_admin();
  IF p_year NOT BETWEEN 1900 AND 2100 OR jsonb_typeof(p_season) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'Temporada no válida' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_team FROM public.teams WHERE id = p_team_id FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Equipo no encontrado' USING ERRCODE = 'P0002'; END IF;
  IF v_team."specialEdition" THEN
    RAISE EXCEPTION 'Las ediciones especiales se editan en su ficha propia' USING ERRCODE = '23514';
  END IF;
  IF v_name = ''
     OR (v_category IS NOT NULL AND v_category NOT IN ('WT','WWT','PT','PRW','CT','CTW','NTM','NTW','CLUBM','CLUBW'))
     OR (v_gender IS NOT NULL AND v_gender NOT IN ('male','female'))
     OR (v_uci_code IS NOT NULL AND v_uci_code !~ '^[^[:space:]]{3}$')
     OR v_header_bg !~ '^#[0-9a-f]{6}$' OR v_header_text !~ '^#[0-9a-f]{6}$'
     OR v_torso_center !~ '^#[0-9a-f]{6}$' OR v_torso_sides !~ '^#[0-9a-f]{6}$'
     OR (v_inner_circle IS NOT NULL AND v_inner_circle !~ '^#[0-9a-f]{6}$')
     OR v_shorts !~ '^#[0-9a-f]{6}$' OR jsonb_typeof(v_translations) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'Datos de temporada no válidos' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.team_seasons (
    id,"teamId",year,name,"nameAliases",category,gender,"uciCode",
    "headerBg","headerText","badgeTorsoCenter","badgeTorsoSides",
    "badgeInnerCircle","badgeShorts",translations,"badgeVisible","continuityDoubt"
  ) VALUES (
    p_team_id || '_' || p_year,p_team_id,p_year,v_name,v_aliases,v_category,v_gender,v_uci_code,
    v_header_bg,v_header_text,v_torso_center,v_torso_sides,v_inner_circle,v_shorts,v_translations,
    COALESCE((p_season->>'badgeVisible')::boolean, true),
    COALESCE((p_season->>'continuityDoubt')::boolean, false)
  )
  ON CONFLICT ("teamId",year) DO UPDATE SET
    name=EXCLUDED.name,"nameAliases"=EXCLUDED."nameAliases",category=EXCLUDED.category,
    gender=EXCLUDED.gender,"uciCode"=EXCLUDED."uciCode","headerBg"=EXCLUDED."headerBg",
    "headerText"=EXCLUDED."headerText","badgeTorsoCenter"=EXCLUDED."badgeTorsoCenter",
    "badgeTorsoSides"=EXCLUDED."badgeTorsoSides","badgeInnerCircle"=EXCLUDED."badgeInnerCircle",
    "badgeShorts"=EXCLUDED."badgeShorts",translations=EXCLUDED.translations,"badgeVisible"=EXCLUDED."badgeVisible",
    "continuityDoubt"=EXCLUDED."continuityDoubt","updatedAt"=now()
  RETURNING * INTO v_row;
  RETURN to_jsonb(v_row);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_edit_regular_team_affiliation(
  p_action text,
  p_team_id text,
  p_year integer,
  p_rider_id text,
  p_rider_gender text,
  p_affiliation_id text DEFAULT NULL,
  p_date_from date DEFAULT NULL,
  p_date_to date DEFAULT NULL,
  p_verified boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_id text;
  v_row public.rider_team_affiliations%ROWTYPE;
  v_existing_count integer;
BEGIN
  PERFORM private.assert_startlist_import_admin();
  IF p_action NOT IN ('add','update','remove') OR p_year NOT BETWEEN 1900 AND 2100
     OR p_rider_gender NOT IN ('male','female')
     OR (p_date_from IS NOT NULL AND extract(year FROM p_date_from)::integer <> p_year)
     OR (p_date_to IS NOT NULL AND extract(year FROM p_date_to)::integer <> p_year)
     OR (p_date_from IS NOT NULL AND p_date_to IS NOT NULL AND p_date_from > p_date_to) THEN
    RAISE EXCEPTION 'Afiliación no válida' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.team_seasons WHERE "teamId"=p_team_id AND year=p_year) THEN
    RAISE EXCEPTION 'Crea primero la temporada del equipo' USING ERRCODE = '23503';
  END IF;
  IF (p_rider_gender='male' AND NOT EXISTS (SELECT 1 FROM public.riders_men WHERE id=p_rider_id))
     OR (p_rider_gender='female' AND NOT EXISTS (SELECT 1 FROM public.riders_women WHERE id=p_rider_id)) THEN
    RAISE EXCEPTION 'Corredor no encontrado' USING ERRCODE = 'P0002';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('regular-team-roster:'||p_team_id,0));
  PERFORM pg_advisory_xact_lock(hashtextextended('uci-catalog-rider:'||p_rider_gender||':'||p_rider_id,0));

  IF p_action IN ('update','remove') THEN
    SELECT * INTO v_row FROM public.rider_team_affiliations
      WHERE id=p_affiliation_id AND "teamId"=p_team_id AND year=p_year
        AND "riderId"=p_rider_id AND "riderGender"=p_rider_gender
        AND "affiliationType"='regular' FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Afiliación habitual no encontrada' USING ERRCODE = 'P0002'; END IF;
    IF p_action='remove' THEN
      DELETE FROM public.rider_team_affiliations WHERE id=v_row.id;
      RETURN jsonb_build_object('action','removed','id',v_row.id);
    END IF;
    UPDATE public.rider_team_affiliations SET
      "dateFrom"=p_date_from,"dateTo"=p_date_to,source='panel',"dateFromPrecision"=NULL,
      "dateToPrecision"=NULL,"updatedAt"=now()
      WHERE id=v_row.id RETURNING * INTO v_row;
    RETURN to_jsonb(v_row);
  END IF;

  SELECT count(*) INTO v_existing_count FROM public.rider_team_affiliations a
    WHERE a."riderId"=p_rider_id AND a."riderGender"=p_rider_gender AND a.year=p_year
      AND a."affiliationType"='regular'
      AND daterange(COALESCE(a."dateFrom",make_date(p_year,1,1)),COALESCE(a."dateTo",make_date(p_year,12,31)),'[]')
          && daterange(COALESCE(p_date_from,make_date(p_year,1,1)),COALESCE(p_date_to,make_date(p_year,12,31)),'[]');
  IF v_existing_count > 0 THEN
    RAISE EXCEPTION 'El corredor ya tiene una afiliación habitual solapada en %',p_year USING ERRCODE = '23P01';
  END IF;
  v_id := gen_random_uuid()::text;
  INSERT INTO public.rider_team_affiliations (
    id,"riderId","riderGender","teamId",year,"dateFrom","dateTo",source,verified,"affiliationType","updatedAt"
  ) VALUES (
    v_id,p_rider_id,p_rider_gender,p_team_id,p_year,p_date_from,p_date_to,'panel',p_verified,'regular',now()
  ) RETURNING * INTO v_row;
  RETURN to_jsonb(v_row);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_delete_team_season(p_team_id text,p_year integer)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE v_row public.team_seasons%ROWTYPE;
BEGIN
  PERFORM private.assert_startlist_import_admin();
  IF p_year NOT BETWEEN 1900 AND 2100 THEN RAISE EXCEPTION 'Temporada no válida' USING ERRCODE='22023'; END IF;
  IF EXISTS (SELECT 1 FROM public.rider_team_affiliations WHERE "teamId"=p_team_id AND year=p_year) THEN
    RAISE EXCEPTION 'La temporada tiene afiliaciones; no puede eliminarse' USING ERRCODE='23503';
  END IF;
  DELETE FROM public.team_seasons WHERE "teamId"=p_team_id AND year=p_year RETURNING * INTO v_row;
  RETURN CASE WHEN v_row.id IS NULL THEN NULL ELSE to_jsonb(v_row) END;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_save_team_season(text,integer,jsonb),
  public.admin_edit_regular_team_affiliation(text,text,integer,text,text,text,date,date,boolean),
  public.admin_delete_team_season(text,integer)
  FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.admin_save_team_season(text,integer,jsonb),
  public.admin_edit_regular_team_affiliation(text,text,integer,text,text,text,date,date,boolean),
  public.admin_delete_team_season(text,integer)
  TO authenticated,service_role;

COMMENT ON FUNCTION public.admin_save_team_season(text,integer,jsonb) IS
  'Guarda solo la identidad estacional de un equipo; no modifica teams ni otras temporadas.';
COMMENT ON FUNCTION public.admin_edit_regular_team_affiliation(text,text,integer,text,text,text,date,date,boolean) IS
  'Contrato administrativo para altas, fechas y bajas de afiliaciones habituales de una temporada.';
COMMENT ON FUNCTION public.admin_delete_team_season(text,integer) IS
  'Elimina una temporada sin afiliaciones; no modifica la ficha matriz ni otras temporadas.';

COMMIT;
