-- Invalidación del origen y destino al reasignar filas, y de categorías retiradas.
CREATE OR REPLACE FUNCTION private.cx_standings_changed() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE old_row jsonb; new_row jsonb; race_id text; target text; source_category text;
BEGIN
  IF TG_OP<>'INSERT' THEN old_row:=to_jsonb(OLD); END IF;
  IF TG_OP<>'DELETE' THEN new_row:=to_jsonb(NEW); END IF;
  IF TG_TABLE_NAME='cx_tournaments' THEN
    IF TG_OP='UPDATE' AND old_row->'pointsScheme' IS NOT DISTINCT FROM new_row->'pointsScheme' THEN RETURN NULL; END IF;
    FOR source_category IN SELECT key FROM jsonb_each(coalesce(old_row#>'{pointsScheme,categories}','{}'))
      WHERE key IN ('ME','WE','MU','WU','MJ','WJ') AND NOT coalesce(new_row#>'{pointsScheme,categories}','{}') ? key LOOP
      target:=coalesce(new_row,old_row)->>'id';
      DELETE FROM public.cx_tournament_standings WHERE "tournamentId"=target AND category=source_category AND source='computed';
      UPDATE public.cx_standings_state SET status=CASE WHEN status='manual' THEN 'manual' ELSE 'pending' END,
        "inputDigest"=NULL,"updatedAt"=now() WHERE "tournamentId"=target AND category=source_category;
      INSERT INTO private.cx_standings_queue("tournamentId",category) VALUES(target,source_category)
        ON CONFLICT ("tournamentId",category) DO UPDATE SET status='pending',generation=cx_standings_queue.generation+1,
          "requestedAt"=now(),"claimedAt"=NULL,"finishedAt"=NULL,"lastError"=NULL;
    END LOOP;
    PERFORM private.cx_enqueue_standings(coalesce(new_row,old_row)->>'id');
  ELSIF TG_TABLE_NAME='cx_races' THEN
    IF TG_OP='UPDATE' AND (old_row - ARRAY['name','nameEn','slug','slugEn','abbrev','colorHex','logoUrl','venue','websiteUrl','timezone'])
      IS NOT DISTINCT FROM (new_row - ARRAY['name','nameEn','slug','slugEn','abbrev','colorHex','logoUrl','venue','websiteUrl','timezone']) THEN RETURN NULL; END IF;
    PERFORM private.cx_enqueue_standings(old_row->>'tournamentId');
    IF new_row->>'tournamentId' IS DISTINCT FROM old_row->>'tournamentId' THEN PERFORM private.cx_enqueue_standings(new_row->>'tournamentId'); END IF;
  ELSIF TG_TABLE_NAME IN ('cx_riders_men','cx_riders_women') THEN
    IF TG_OP='UPDATE' AND old_row->'birthDate' IS NOT DISTINCT FROM new_row->'birthDate'
      AND old_row->'verified' IS NOT DISTINCT FROM new_row->'verified' THEN RETURN NULL; END IF;
    FOR target,source_category IN SELECT DISTINCT r."tournamentId",x.category FROM public.cx_results x
      JOIN public.cx_races r ON r.id=x."raceId" WHERE r."tournamentId" IS NOT NULL
      AND x."globalRiderId"=coalesce(new_row,old_row)->>'id'
      AND left(x.category,1)=CASE WHEN TG_TABLE_NAME='cx_riders_men' THEN 'M' ELSE 'W' END LOOP
      PERFORM private.cx_enqueue_standings(target,source_category);
    END LOOP;
  ELSE
    IF TG_TABLE_NAME='cx_race_categories' AND TG_OP='UPDATE' AND
      (old_row - ARRAY['startlistImportedAt','winnerName','durationFormat','durationMinutes','durationRuleVersion','durationRuleSourceUrl','scheduleSourceUrl'])
      IS NOT DISTINCT FROM (new_row - ARRAY['startlistImportedAt','winnerName','durationFormat','durationMinutes','durationRuleVersion','durationRuleSourceUrl','scheduleSourceUrl']) THEN RETURN NULL; END IF;
    FOR race_id,source_category IN SELECT DISTINCT v.race,v.category FROM
      (VALUES (old_row->>'raceId',old_row->>'category'),(new_row->>'raceId',new_row->>'category')) v(race,category)
      WHERE v.race IS NOT NULL AND v.category IS NOT NULL LOOP
      SELECT "tournamentId" INTO target FROM public.cx_races WHERE id=race_id;
      PERFORM private.cx_enqueue_standings(target,source_category);
    END LOOP;
  END IF;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION private.cx_standings_changed() FROM PUBLIC,anon,authenticated,service_role,cc_results_worker;
