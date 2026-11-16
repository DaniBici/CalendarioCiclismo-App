-- Generales CX: rondas externas declaradas en el reglamento de la categoría.
-- `pointsScheme.categories.<cat>.extras.externalRounds` = [{"raceId": "<id>"}]
-- incorpora al cálculo carreras de otro torneo de la misma temporada (la Copa
-- Catalana 2026-27 puntúa el Dark Cross de Les Franqueses, ronda de la Copa de
-- España). El snapshot las añade a las rondas y al catálogo de corredores, y la
-- invalidación encola también los torneos que las declaran.

CREATE OR REPLACE FUNCTION private.cx_external_round_ids(p_scheme jsonb, p_category text)
RETURNS text[] LANGUAGE sql IMMUTABLE SET search_path='' AS $$
  SELECT coalesce(array_agg(DISTINCT e->>'raceId'),'{}')
  FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p_scheme#>ARRAY['categories',p_category,'extras','externalRounds'])='array'
    THEN p_scheme#>ARRAY['categories',p_category,'extras','externalRounds'] ELSE '[]'::jsonb END) e
  WHERE jsonb_typeof(e)='object' AND coalesce(e->>'raceId','')<>''
$$;

CREATE OR REPLACE FUNCTION public.cx_standings_snapshot(p_tournament_id text, p_category text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE tournament public.cx_tournaments; source_category text; payload jsonb; rounds jsonb; riders jsonb; external_ids text[];
BEGIN
  IF current_user<>'cc_results_worker' AND session_user<>'cc_results_worker'
    AND coalesce(current_setting('role',true),'')<>'cc_results_worker' THEN PERFORM public.cx_require_admin(); END IF;
  SELECT * INTO tournament FROM public.cx_tournaments WHERE id=p_tournament_id;
  IF NOT FOUND OR p_category IS NULL OR p_category NOT IN ('ME','WE','MU','WU','MJ','WJ') THEN
    RAISE EXCEPTION 'Torneo o categoría inválidos' USING ERRCODE='22023';
  END IF;
  source_category:=coalesce(tournament."pointsScheme"#>>ARRAY['categories',p_category,'extras','derived','fromCategory'],p_category);
  -- Cálculo en línea: la función se ejecuta con el rol del trabajador o del administrador.
  SELECT coalesce(array_agg(DISTINCT e->>'raceId'),'{}') INTO external_ids
    FROM jsonb_array_elements(CASE WHEN jsonb_typeof(tournament."pointsScheme"#>ARRAY['categories',p_category,'extras','externalRounds'])='array'
      THEN tournament."pointsScheme"#>ARRAY['categories',p_category,'extras','externalRounds'] ELSE '[]'::jsonb END) e
    WHERE jsonb_typeof(e)='object' AND coalesce(e->>'raceId','')<>'';
  SELECT coalesce(jsonb_agg(jsonb_build_object('race',to_jsonb(r),'manga',to_jsonb(c)-ARRAY['resultsLockedAt','resultsProvider','resultsInputDigest'],'results',
    (SELECT coalesce(jsonb_agg(to_jsonb(x)||jsonb_build_object('points',x.points::text,'bonusPoints',coalesce(x."bonusPoints",0)::text,
      'timeSeconds',x."timeSeconds"::text) ORDER BY x."sortOrder",x.id),'[]')
      FROM public.cx_results x WHERE x."raceId"=r.id AND x.category=source_category))
    ORDER BY coalesce(c."dateKey",r."dateKey"),c."startTimeUtc" NULLS LAST,r.id),'[]') INTO rounds
    FROM public.cx_races r JOIN public.cx_race_categories c ON c."raceId"=r.id AND c.category=source_category
    WHERE (r."tournamentId"=p_tournament_id OR r.id=ANY(external_ids)) AND r."seasonKey"=tournament."seasonKey";
  SELECT coalesce(jsonb_agg(to_jsonb(v) ORDER BY v.id),'[]') INTO riders FROM (
    SELECT id,"birthDate",verified FROM public.cx_riders_men WHERE left(source_category,1)='M' AND id IN
      (SELECT x."globalRiderId" FROM public.cx_results x JOIN public.cx_races r ON r.id=x."raceId"
        WHERE (r."tournamentId"=p_tournament_id OR r.id=ANY(external_ids)) AND x.category=source_category)
    UNION ALL
    SELECT id,"birthDate",verified FROM public.cx_riders_women WHERE left(source_category,1)='W' AND id IN
      (SELECT x."globalRiderId" FROM public.cx_results x JOIN public.cx_races r ON r.id=x."raceId"
        WHERE (r."tournamentId"=p_tournament_id OR r.id=ANY(external_ids)) AND x.category=source_category)
  ) v;
  payload:=jsonb_build_object('tournament',to_jsonb(tournament),'category',p_category,'rounds',rounds,'riders',riders);
  RETURN jsonb_build_object('input',payload,'digest',md5(payload::text));
END $function$;

-- Encola cada torneo que declara la carrera como ronda externa de la categoría
-- afectada (NULL: cualquier categoría).
CREATE OR REPLACE FUNCTION private.cx_enqueue_external_round(p_race_id text, p_category text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE target text;
BEGIN
  IF p_race_id IS NULL THEN RETURN; END IF;
  FOR target IN SELECT t.id FROM public.cx_tournaments t WHERE EXISTS(
    SELECT 1 FROM jsonb_each(coalesce(t."pointsScheme"->'categories','{}')) c
    WHERE c.key IN ('ME','WE','MU','WU','MJ','WJ')
      AND (p_category IS NULL OR c.key=p_category OR c.value#>>'{extras,derived,fromCategory}'=p_category)
      AND p_race_id=ANY(private.cx_external_round_ids(t."pointsScheme",c.key))) LOOP
    PERFORM private.cx_enqueue_standings(target,p_category);
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION private.cx_standings_changed()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
    IF TG_OP='UPDATE' AND (old_row - ARRAY['name','nameEn','slug','slugEn','abbrev','colorHex','logoUrl','venue','websiteUrl','timezone','tvStatus'])
      IS NOT DISTINCT FROM (new_row - ARRAY['name','nameEn','slug','slugEn','abbrev','colorHex','logoUrl','venue','websiteUrl','timezone','tvStatus']) THEN RETURN NULL; END IF;
    PERFORM private.cx_enqueue_standings(old_row->>'tournamentId');
    IF new_row->>'tournamentId' IS DISTINCT FROM old_row->>'tournamentId' THEN PERFORM private.cx_enqueue_standings(new_row->>'tournamentId'); END IF;
    PERFORM private.cx_enqueue_external_round(coalesce(new_row,old_row)->>'id');
  ELSIF TG_TABLE_NAME IN ('cx_riders_men','cx_riders_women') THEN
    IF TG_OP='UPDATE' AND old_row->'birthDate' IS NOT DISTINCT FROM new_row->'birthDate'
      AND old_row->'verified' IS NOT DISTINCT FROM new_row->'verified' THEN RETURN NULL; END IF;
    FOR target,source_category IN SELECT DISTINCT r."tournamentId",x.category FROM public.cx_results x
      JOIN public.cx_races r ON r.id=x."raceId" WHERE r."tournamentId" IS NOT NULL
      AND x."globalRiderId"=coalesce(new_row,old_row)->>'id'
      AND left(x.category,1)=CASE WHEN TG_TABLE_NAME='cx_riders_men' THEN 'M' ELSE 'W' END LOOP
      PERFORM private.cx_enqueue_standings(target,source_category);
    END LOOP;
    FOR race_id,source_category IN SELECT DISTINCT x."raceId",x.category FROM public.cx_results x
      WHERE x."globalRiderId"=coalesce(new_row,old_row)->>'id'
      AND left(x.category,1)=CASE WHEN TG_TABLE_NAME='cx_riders_men' THEN 'M' ELSE 'W' END LOOP
      PERFORM private.cx_enqueue_external_round(race_id,source_category);
    END LOOP;
  ELSE
    IF TG_TABLE_NAME='cx_race_categories' AND TG_OP='UPDATE' AND
      (old_row - ARRAY['startlistImportedAt','winnerName','durationFormat','durationMinutes','durationRuleVersion','durationRuleSourceUrl','scheduleSourceUrl','resultsLockedAt','resultsProvider','resultsInputDigest'])
      IS NOT DISTINCT FROM (new_row - ARRAY['startlistImportedAt','winnerName','durationFormat','durationMinutes','durationRuleVersion','durationRuleSourceUrl','scheduleSourceUrl','resultsLockedAt','resultsProvider','resultsInputDigest']) THEN RETURN NULL; END IF;
    FOR race_id,source_category IN SELECT DISTINCT v.race,v.category FROM
      (VALUES (old_row->>'raceId',old_row->>'category'),(new_row->>'raceId',new_row->>'category')) v(race,category)
      WHERE v.race IS NOT NULL AND v.category IS NOT NULL LOOP
      SELECT "tournamentId" INTO target FROM public.cx_races WHERE id=race_id;
      PERFORM private.cx_enqueue_standings(target,source_category);
      PERFORM private.cx_enqueue_external_round(race_id,source_category);
    END LOOP;
  END IF;
  RETURN NULL;
END $function$;

REVOKE ALL ON FUNCTION private.cx_external_round_ids(jsonb,text),private.cx_enqueue_external_round(text,text)
  FROM PUBLIC,anon,authenticated,service_role,cc_results_worker;
