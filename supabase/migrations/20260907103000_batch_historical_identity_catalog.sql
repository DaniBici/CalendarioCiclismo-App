-- Entrada por lotes acotados para aplicar el manifiesto histórico mediante el
-- conector, conservando las validaciones unitarias de cada RPC privada.
BEGIN;

CREATE FUNCTION private.apply_historical_identity_chunk(
  p_batch text,
  p_team_seasons jsonb DEFAULT '[]'::jsonb,
  p_riders jsonb DEFAULT '[]'::jsonb,
  p_rosters jsonb DEFAULT '[]'::jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE item jsonb; v_team_count integer; v_rider_count integer; v_roster_count integer;
BEGIN
  PERFORM private.historical_batch_guard(p_batch);
  IF jsonb_typeof(p_team_seasons) IS DISTINCT FROM 'array'
    OR jsonb_typeof(p_riders) IS DISTINCT FROM 'array'
    OR jsonb_typeof(p_rosters) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'historical_chunk_arrays_required';
  END IF;
  v_team_count:=jsonb_array_length(p_team_seasons);
  v_rider_count:=jsonb_array_length(p_riders);
  v_roster_count:=jsonb_array_length(p_rosters);
  IF v_team_count>100 OR v_rider_count>500 OR v_roster_count>1000
    OR v_team_count+v_rider_count+v_roster_count=0 THEN
    RAISE EXCEPTION 'historical_chunk_size_invalid';
  END IF;

  FOR item IN SELECT value FROM jsonb_array_elements(p_team_seasons) LOOP
    BEGIN
      PERFORM private.upsert_historical_team_season(
        p_batch,(item->>'year')::integer,item->>'profile',NULLIF(item->>'teamId',''),item->>'continuity',
        item->>'name',item->>'code',item->>'gender',item->>'category',item->>'country',
        item->'evidence',item->'appearance'
      );
    EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'historical_team_chunk_item:%:%:%',item->>'year',item->>'profile',SQLERRM; END;
  END LOOP;
  FOR item IN SELECT value FROM jsonb_array_elements(p_riders) LOOP
    BEGIN
      PERFORM private.upsert_historical_rider_profile(
        p_batch,(item->>'year')::integer,item->>'profile',item->>'gender',NULLIF(item->>'riderId',''),
        item->>'firstName',item->>'lastName',item->>'country',(item->>'birthDate')::date,
        NULLIF(item->>'uciLicenseId',''),item->'evidence'
      );
    EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'historical_rider_chunk_item:%:%:%',item->>'year',item->>'profile',SQLERRM; END;
  END LOOP;
  FOR item IN SELECT value FROM jsonb_array_elements(p_rosters) LOOP
    BEGIN
      PERFORM private.record_historical_roster_observation(
        p_batch,(item->>'year')::integer,item->>'teamProfile',item->>'riderProfile',item->>'gender',
        item->>'type',item->>'sourceHash',(item->>'observedAt')::timestamptz
      );
    EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'historical_roster_chunk_item:%:%:%:%',item->>'year',item->>'teamProfile',item->>'riderProfile',SQLERRM; END;
  END LOOP;
  RETURN jsonb_build_object('teams',v_team_count,'riders',v_rider_count,'rosters',v_roster_count);
END;
$$;

REVOKE ALL ON FUNCTION private.apply_historical_identity_chunk(text,jsonb,jsonb,jsonb)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION private.apply_historical_identity_chunk(text,jsonb,jsonb,jsonb) TO service_role;

COMMIT;
