-- Club gemelo de un equipo UCI CX: misma identidad visual (nombre, alias, país,
-- código y colores, sincronizados) para corredores que compiten con el nombre
-- del equipo UCI sin figurar en su plantilla (currentTeamId distinto).

ALTER TABLE public.cx_teams
  ADD COLUMN IF NOT EXISTS "parentTeamId" text REFERENCES public.cx_teams(id) ON DELETE CASCADE;
ALTER TABLE public.cx_teams DROP CONSTRAINT IF EXISTS cx_teams_parent_club_check;
ALTER TABLE public.cx_teams
  ADD CONSTRAINT cx_teams_parent_club_check CHECK ("parentTeamId" IS NULL OR category = 'CLUB');
CREATE UNIQUE INDEX IF NOT EXISTS cx_teams_parent_team_uidx ON public.cx_teams ("parentTeamId");

-- Devuelve (o crea) el club gemelo de un equipo UCI.
CREATE OR REPLACE FUNCTION private.cx_club_twin(p_team_id text, p_race_id text DEFAULT NULL)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE v_parent public.cx_teams; v_id text;
BEGIN
  SELECT * INTO v_parent FROM public.cx_teams WHERE id = p_team_id AND category = 'UCI';
  IF NOT FOUND THEN RETURN p_team_id; END IF;
  SELECT id INTO v_id FROM public.cx_teams WHERE "parentTeamId" = p_team_id;
  IF v_id IS NOT NULL THEN RETURN v_id; END IF;
  v_id := p_team_id || '_club';
  INSERT INTO public.cx_teams (id, name, "nameAliases", gender, "countryCode", "uciCode", "colorHex",
    "headerBg", "headerText", "badgeTorsoCenter", "badgeTorsoSides", "badgeInnerCircle", "badgeShorts",
    category, "parentTeamId")
  VALUES (v_id, v_parent.name, v_parent."nameAliases", v_parent.gender, v_parent."countryCode", v_parent."uciCode",
    v_parent."colorHex", v_parent."headerBg", v_parent."headerText", v_parent."badgeTorsoCenter",
    v_parent."badgeTorsoSides", v_parent."badgeInnerCircle", v_parent."badgeShorts", 'CLUB', p_team_id)
  ON CONFLICT (id) DO NOTHING;
  IF FOUND THEN
    INSERT INTO private.cx_change_log (operation, "raceId", category, before, after, evidence)
    VALUES ('team_club_twin_create', p_race_id, NULL, NULL,
      jsonb_build_object('id', v_id, 'parentTeamId', p_team_id, 'name', v_parent.name), '{}'::jsonb);
  END IF;
  RETURN v_id;
END $$;

-- Equipo que corresponde a una ficha: el UCI si figura en su plantilla; si no,
-- su club gemelo. Sin ficha, el equipo resuelto.
CREATE OR REPLACE FUNCTION private.cx_team_for_rider(p_team_id text, p_male boolean, p_rider_id text, p_race_id text DEFAULT NULL)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE v_current text;
BEGIN
  IF (SELECT auth.role()) = 'authenticated' AND NOT coalesce((SELECT private.is_admin()), false) THEN
    RAISE EXCEPTION 'La operación requiere permisos de administración' USING ERRCODE = '42501';
  END IF;
  IF p_team_id IS NULL OR p_rider_id IS NULL
     OR NOT EXISTS (SELECT 1 FROM public.cx_teams WHERE id = p_team_id AND category = 'UCI') THEN
    RETURN p_team_id;
  END IF;
  IF p_male THEN SELECT "currentTeamId" INTO v_current FROM public.cx_riders_men WHERE id = p_rider_id;
  ELSE SELECT "currentTeamId" INTO v_current FROM public.cx_riders_women WHERE id = p_rider_id; END IF;
  IF v_current = p_team_id THEN RETURN p_team_id; END IF;
  RETURN private.cx_club_twin(p_team_id, p_race_id);
END $$;

-- Sincroniza los gemelos con su equipo UCI.
CREATE OR REPLACE FUNCTION private.cx_club_twin_sync()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
BEGIN
  UPDATE public.cx_teams c SET name = NEW.name, "nameAliases" = NEW."nameAliases", gender = NEW.gender,
    "countryCode" = NEW."countryCode", "uciCode" = NEW."uciCode", "colorHex" = NEW."colorHex",
    "headerBg" = NEW."headerBg", "headerText" = NEW."headerText", "badgeTorsoCenter" = NEW."badgeTorsoCenter",
    "badgeTorsoSides" = NEW."badgeTorsoSides", "badgeInnerCircle" = NEW."badgeInnerCircle", "badgeShorts" = NEW."badgeShorts"
  WHERE c."parentTeamId" = NEW.id;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS cx_club_twin_sync ON public.cx_teams;
CREATE TRIGGER cx_club_twin_sync
  AFTER UPDATE ON public.cx_teams
  FOR EACH ROW WHEN (NEW."parentTeamId" IS NULL)
  EXECUTE FUNCTION private.cx_club_twin_sync();

-- La resolución por nombre ignora los gemelos: el nombre resuelve al equipo UCI.
CREATE OR REPLACE FUNCTION private.cx_ensure_team(
  p_name text, p_gender text, p_country text DEFAULT NULL,
  p_race_id text DEFAULT NULL, p_source_url text DEFAULT NULL)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_name text := nullif(btrim(regexp_replace(coalesce(p_name,''),'\s+',' ','g')),'');
  v_fold text; v_ids text[]; v_team public.cx_teams; v_id text; v_words text[]; v_code text;
  v_gender text := CASE WHEN p_gender IN ('male','female') THEN p_gender ELSE 'mixed' END;
  v_country text := CASE WHEN upper(left(coalesce(p_country,''),2)) ~ '^[A-Z]{2}$' THEN upper(left(p_country,2)) END;
BEGIN
  IF (SELECT auth.role()) = 'authenticated' AND NOT coalesce((SELECT private.is_admin()), false) THEN
    RAISE EXCEPTION 'La operación requiere permisos de administración' USING ERRCODE = '42501';
  END IF;
  IF v_name IS NULL OR private.cx_is_no_team(v_name) THEN RETURN NULL; END IF;
  v_fold := public.fold_team_name(v_name);
  IF v_fold IS NULL THEN RETURN NULL; END IF;

  SELECT array_agg(t.id ORDER BY t.id) INTO v_ids FROM public.cx_teams t
   WHERE t."parentTeamId" IS NULL
     AND (public.fold_team_name(t.name) = v_fold
      OR EXISTS (SELECT 1 FROM unnest(t."nameAliases") a WHERE public.fold_team_name(a) = v_fold));
  IF coalesce(cardinality(v_ids),0) > 1 THEN RETURN NULL; END IF;

  IF cardinality(v_ids) = 1 THEN
    SELECT * INTO v_team FROM public.cx_teams WHERE id = v_ids[1];
    IF v_team.category = 'CLUB' AND v_gender <> 'mixed' AND v_team.gender NOT IN (v_gender,'mixed') THEN
      UPDATE public.cx_teams SET gender = 'mixed' WHERE id = v_team.id;
    END IF;
    RETURN v_team.id;
  END IF;

  v_id := 'cx_team_auto_' || md5(v_fold);
  v_words := string_to_array(upper(v_fold), ' ');
  v_code := CASE
    WHEN cardinality(v_words) >= 3 THEN left(v_words[1],1) || left(v_words[2],1) || left(v_words[3],1)
    WHEN cardinality(v_words) = 2 THEN left(v_words[1],2) || left(v_words[2],1)
    ELSE left(v_words[1],3) END;
  v_code := rpad(left(regexp_replace(v_code,'[^A-Z0-9]','','g'),3),3,'X');

  INSERT INTO public.cx_teams (id, name, "nameAliases", gender, "countryCode", "uciCode", "colorHex", category)
  VALUES (v_id, v_name, ARRAY[]::text[], v_gender, v_country, v_code, '#ffffff', 'CLUB')
  ON CONFLICT (id) DO NOTHING;
  IF FOUND THEN
    INSERT INTO private.cx_change_log (operation, "raceId", category, before, after, evidence)
    VALUES ('team_auto_create', p_race_id, NULL, NULL,
      jsonb_build_object('id', v_id, 'name', v_name, 'gender', v_gender, 'countryCode', v_country, 'uciCode', v_code),
      jsonb_strip_nulls(jsonb_build_object('sourceUrl', p_source_url)));
  END IF;
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION private.cx_results_team_link()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE v_male boolean := left(NEW.category,1) = 'M'; v_team_id text; v_source text;
BEGIN
  IF nullif(btrim(NEW."teamName"),'') IS NOT NULL THEN
    IF TG_OP = 'UPDATE' AND NEW."teamName" IS NOT DISTINCT FROM OLD."teamName"
       AND NEW."globalRiderId" IS NOT DISTINCT FROM OLD."globalRiderId" THEN
      RETURN NEW;
    END IF;
    SELECT coalesce(c."resultsSourceUrl", r."websiteUrl") INTO v_source
      FROM public.cx_races r LEFT JOIN public.cx_race_categories c
        ON c."raceId" = r.id AND c.category = NEW.category
     WHERE r.id = NEW."raceId";
    v_team_id := private.cx_ensure_team(NEW."teamName", CASE WHEN v_male THEN 'male' ELSE 'female' END,
      NEW."isoCode2", NEW."raceId", v_source);
    v_team_id := private.cx_team_for_rider(v_team_id, v_male, NEW."globalRiderId", NEW."raceId");
    PERFORM private.cx_link_rider_team(v_male, NEW."globalRiderId", v_team_id);
  ELSIF NEW."globalRiderId" IS NOT NULL
        AND (TG_OP = 'INSERT' OR NEW."globalRiderId" IS DISTINCT FROM OLD."globalRiderId") THEN
    IF v_male THEN
      SELECT t.name INTO NEW."teamName" FROM public.cx_riders_men r
        JOIN public.cx_teams t ON t.id = r."currentTeamId" WHERE r.id = NEW."globalRiderId";
    ELSE
      SELECT t.name INTO NEW."teamName" FROM public.cx_riders_women r
        JOIN public.cx_teams t ON t.id = r."currentTeamId" WHERE r.id = NEW."globalRiderId";
    END IF;
  END IF;
  RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION private.cx_club_twin(text,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.cx_club_twin_sync() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.cx_team_for_rider(text,boolean,text,text) FROM PUBLIC, anon, authenticated;
-- cx_prepare_startlist_import (SECURITY INVOKER, administrador) elige el gemelo.
GRANT EXECUTE ON FUNCTION private.cx_team_for_rider(text,boolean,text,text) TO authenticated;

-- Inscritos: un teamName de equipo UCI para una ficha fuera de su plantilla usa el gemelo.
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
    OR coalesce(p_document->>'sourceUrl','') !~ '^https?://' THEN
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
END $function$;
