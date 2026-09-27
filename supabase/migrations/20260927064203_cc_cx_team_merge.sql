-- Fusión de equipos CX duplicados: el nombre y los alias del duplicado pasan a
-- alias del equipo conservado; fichas e inscritos se reasignan; el duplicado se
-- elimina. Los textos de resultados no cambian: resuelven por alias.
CREATE OR REPLACE FUNCTION private.cx_merge_team(p_keep text, p_drop text, p_reason text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE v_keep public.cx_teams; v_drop public.cx_teams; v_men int; v_women int; v_start int;
BEGIN
  SELECT * INTO v_keep FROM public.cx_teams WHERE id = p_keep FOR UPDATE;
  SELECT * INTO v_drop FROM public.cx_teams WHERE id = p_drop FOR UPDATE;
  IF v_keep.id IS NULL OR v_drop.id IS NULL OR p_keep = p_drop THEN
    RAISE EXCEPTION 'Equipos de fusión inexistentes o iguales' USING ERRCODE = '22023';
  END IF;
  IF v_drop.category = 'UCI' OR v_drop."parentTeamId" IS NOT NULL OR v_keep."parentTeamId" IS NOT NULL THEN
    RAISE EXCEPTION 'Solo se fusionan clubes sin gemelo en un equipo sin padre' USING ERRCODE = '22023';
  END IF;
  UPDATE public.cx_riders_men SET "currentTeamId" = p_keep, "updatedAt" = now() WHERE "currentTeamId" = p_drop;
  GET DIAGNOSTICS v_men = ROW_COUNT;
  UPDATE public.cx_riders_women SET "currentTeamId" = p_keep, "updatedAt" = now() WHERE "currentTeamId" = p_drop;
  GET DIAGNOSTICS v_women = ROW_COUNT;
  UPDATE public.cx_startlist_riders SET "teamId" = p_keep WHERE "teamId" = p_drop;
  GET DIAGNOSTICS v_start = ROW_COUNT;
  DELETE FROM public.cx_teams WHERE id = p_drop;
  UPDATE public.cx_teams SET
    "nameAliases" = (SELECT coalesce(array_agg(DISTINCT a ORDER BY a), ARRAY[]::text[])
      FROM unnest(v_keep."nameAliases" || v_drop."nameAliases" || ARRAY[v_drop.name]) a
      WHERE public.fold_team_name(a) IS DISTINCT FROM public.fold_team_name(v_keep.name) OR a = upper(v_keep.name)),
    gender = CASE WHEN v_keep.gender = v_drop.gender THEN v_keep.gender ELSE 'mixed' END,
    "countryCode" = coalesce(v_keep."countryCode", v_drop."countryCode")
  WHERE id = p_keep;
  INSERT INTO private.cx_change_log (operation, "raceId", category, before, after, evidence)
  VALUES ('team_merge', NULL, NULL, to_jsonb(v_drop),
    jsonb_build_object('keep', p_keep, 'men', v_men, 'women', v_women, 'startlist', v_start),
    jsonb_strip_nulls(jsonb_build_object('reason', p_reason)));
  RETURN jsonb_build_object('keep', p_keep, 'drop', p_drop, 'men', v_men, 'women', v_women, 'startlist', v_start);
END $$;

REVOKE ALL ON FUNCTION private.cx_merge_team(text,text,text) FROM PUBLIC, anon, authenticated;
