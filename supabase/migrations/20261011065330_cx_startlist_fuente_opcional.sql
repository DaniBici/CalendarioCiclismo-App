-- Inscritos CX: la fuente deja de ser obligatoria; si se indica, debe ser http(s).
CREATE OR REPLACE FUNCTION public.cx_prepare_startlist_import(p_race_id text, p_category text, p_document jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE payload jsonb; row public.cx_startlist_riders; rows jsonb:='[]'; snapshot text; iid uuid; matched integer:=0;
  rider record; candidate_count integer; male boolean; team_from_name boolean;
BEGIN
  PERFORM public.cx_require_admin();
  PERFORM 1 FROM public.cx_race_categories WHERE "raceId"=p_race_id AND category=p_category FOR UPDATE;
  IF NOT FOUND OR jsonb_typeof(p_document->'rows') IS DISTINCT FROM 'array' OR jsonb_array_length(p_document->'rows')=0
    OR coalesce(nullif(btrim(p_document->>'sourceUrl'),''),'https://') !~ '^https?://' THEN
    RAISE EXCEPTION 'Categoría, fuente o inscritos inválidos' USING ERRCODE='22023';
  END IF;
  male:=left(p_category,1)='M';
  FOR payload IN SELECT value FROM jsonb_array_elements(p_document->'rows') LOOP
    row:=jsonb_populate_record(NULL::public.cx_startlist_riders,payload);
    IF coalesce(btrim(row."firstName"),'')='' OR coalesce(btrim(row."lastName"),'')='' THEN
      RAISE EXCEPTION 'Inscrito sin nombre y apellido' USING ERRCODE='22023';
    END IF;
    team_from_name:=row."teamId" IS NULL AND nullif(btrim(payload->>'teamName'),'') IS NOT NULL;
    IF team_from_name THEN
      row."teamId":=private.cx_ensure_team(payload->>'teamName',CASE WHEN male THEN 'male' ELSE 'female' END,
        row."countryCode",p_race_id,p_document->>'sourceUrl');
    END IF;
    IF row."globalRiderId" IS NOT NULL THEN
      IF NOT EXISTS(SELECT 1 FROM public.cx_riders_men WHERE male AND id=row."globalRiderId"
          UNION ALL SELECT 1 FROM public.cx_riders_women WHERE NOT male AND id=row."globalRiderId") THEN
        RAISE EXCEPTION 'Ficha CX inexistente o de otro género: %',row."globalRiderId" USING ERRCODE='22023';
      END IF;
    ELSE
      SELECT count(*) INTO candidate_count FROM (
        SELECT id FROM public.cx_riders_men WHERE male AND lower(btrim("firstName"))=lower(btrim(row."firstName")) AND lower(btrim("lastName"))=lower(btrim(row."lastName"))
          AND (row."countryCode" IS NULL OR nationality=row."countryCode")
        UNION ALL
        SELECT id FROM public.cx_riders_women WHERE NOT male AND lower(btrim("firstName"))=lower(btrim(row."firstName")) AND lower(btrim("lastName"))=lower(btrim(row."lastName"))
          AND (row."countryCode" IS NULL OR nationality=row."countryCode")
      ) x;
      IF candidate_count=1 THEN
        SELECT * INTO rider FROM (
          SELECT id,"currentTeamId" FROM public.cx_riders_men WHERE male AND lower(btrim("firstName"))=lower(btrim(row."firstName")) AND lower(btrim("lastName"))=lower(btrim(row."lastName")) AND (row."countryCode" IS NULL OR nationality=row."countryCode")
          UNION ALL
          SELECT id,"currentTeamId" FROM public.cx_riders_women WHERE NOT male AND lower(btrim("firstName"))=lower(btrim(row."firstName")) AND lower(btrim("lastName"))=lower(btrim(row."lastName")) AND (row."countryCode" IS NULL OR nationality=row."countryCode")
        ) x;
        row."globalRiderId":=rider.id;
      END IF;
    END IF;
    IF row."globalRiderId" IS NOT NULL THEN
      matched:=matched+1;
      SELECT "currentTeamId" INTO rider FROM public.cx_riders_men WHERE male AND id=row."globalRiderId"
        UNION ALL SELECT "currentTeamId" FROM public.cx_riders_women WHERE NOT male AND id=row."globalRiderId";
      IF team_from_name THEN
        row."teamId":=private.cx_team_for_rider(row."teamId",male,row."globalRiderId",p_race_id);
      END IF;
      row."teamId":=coalesce(row."teamId",rider."currentTeamId");
    END IF;
    IF row."teamId" IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.cx_teams WHERE id=row."teamId") THEN
      RAISE EXCEPTION 'Equipo CX inexistente' USING ERRCODE='22023';
    END IF;
    rows:=rows||jsonb_build_array(jsonb_build_object('bib',nullif(btrim(row.bib),''),'firstName',row."firstName",'lastName',row."lastName",'countryCode',row."countryCode",'globalRiderId',row."globalRiderId",'teamId',row."teamId",'sortOrder',jsonb_array_length(rows)));
  END LOOP;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(rows) v WHERE v->>'bib' IS NOT NULL GROUP BY v->>'bib' HAVING count(*)>1)
    OR EXISTS(SELECT 1 FROM jsonb_array_elements(rows) v WHERE v->>'globalRiderId' IS NOT NULL GROUP BY v->>'globalRiderId' HAVING count(*)>1) THEN
    RAISE EXCEPTION 'Dorsal o ficha duplicados' USING ERRCODE='22023';
  END IF;
  SELECT md5(coalesce(jsonb_agg(to_jsonb(x) ORDER BY x."sortOrder",x.id)::text,'[]')) INTO snapshot
    FROM public.cx_startlist_riders x WHERE "raceId"=p_race_id AND category=p_category;
  INSERT INTO private.cx_startlist_imports("raceId",category,document,"expectedSnapshot")
    VALUES(p_race_id,p_category,p_document||jsonb_build_object('rows',rows),snapshot) RETURNING id INTO iid;
  RETURN jsonb_build_object('importId',iid,'raceId',p_race_id,'category',p_category,'rows',rows,'matched',matched,'unmatched',jsonb_array_length(rows)-matched,'status','prepared');
END $function$
;
