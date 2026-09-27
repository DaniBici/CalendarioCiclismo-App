-- Sin fecha de inicio no se acredita que la prueba cubra la carrera.
CREATE OR REPLACE FUNCTION public.startlist_team_roster(p_race_id text, p_team_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
DECLARE
  v_race public.races%ROWTYPE; v_team public.teams%ROWTYPE;
  v_year integer; v_start date; v_end date; v_roster jsonb;
BEGIN
  IF current_user NOT IN ('postgres','supabase_admin','service_role')
     AND NOT COALESCE(private.is_admin(),false) THEN
    RAISE EXCEPTION 'Se requieren permisos de administración' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO STRICT v_race FROM public.races WHERE id = p_race_id;
  SELECT * INTO STRICT v_team FROM public.teams WHERE id = p_team_id;
  -- parentTeamId solo normaliza una edición especial. No implica filiación.
  IF v_team."specialEdition" THEN
    SELECT * INTO v_team FROM public.teams WHERE id = v_team."parentTeamId" AND NOT "specialEdition";
    IF NOT FOUND THEN RETURN '[]'::jsonb; END IF;
  END IF;
  IF v_race.gender IS NULL OR v_race.gender NOT IN ('male','female')
     OR (v_team.gender IS NOT NULL AND v_team.gender <> v_race.gender)
     OR v_team."teamKind" = 'selection' OR v_team.category IN ('NTM','NTW') THEN
    RETURN '[]'::jsonb;
  END IF;
  v_start := COALESCE(v_race."startDate",v_race."endDate")::date;
  v_end := COALESCE(v_race."endDate",v_race."startDate")::date;
  v_year := COALESCE(v_race.year,extract(year FROM v_start)::integer,extract(year FROM current_date)::integer);
  WITH related_ids AS (
    SELECT v_team.id AS id
    UNION
    SELECT l."developmentTeamId" FROM public.team_development_links l
      WHERE l.year = v_year AND l."mainTeamId" = v_team.id
    UNION
    SELECT l."mainTeamId" FROM public.team_development_links l
      WHERE l.year = v_year AND l."developmentTeamId" = v_team.id
  ), eligible_teams AS (
    SELECT t.id,t.name FROM public.teams t JOIN related_ids r ON r.id=t.id
    WHERE NOT t."specialEdition" AND (t.gender IS NULL OR t.gender = v_race.gender)
      AND t."teamKind" IS DISTINCT FROM 'selection' AND COALESCE(t.category,'') NOT IN ('NTM','NTW')
  ), roster_team_ids AS (
    SELECT t.id AS stored_id,t.id FROM eligible_teams t
    UNION ALL
    SELECT edition.id,base.id FROM public.teams edition
    JOIN eligible_teams base ON base.id=edition."parentTeamId"
    WHERE edition."specialEdition"
      AND (edition.gender IS NULL OR edition.gender=v_race.gender)
      AND edition."teamKind" IS DISTINCT FROM 'selection'
      AND COALESCE(edition.category,'') NOT IN ('NTM','NTW')
  ), affiliations AS (
    SELECT a."riderId",t.id AS "teamId",a."affiliationType" FROM public.rider_team_affiliations a
    JOIN roster_team_ids t ON t.stored_id = a."teamId"
    WHERE a.year = v_year AND a."riderGender" = v_race.gender
      AND (
        (a."affiliationType" = 'regular'
          AND (v_end IS NULL OR a."dateFrom" IS NULL OR a."dateFrom" <= v_end))
        OR
        -- Vínculo individual: no se extiende a equipos relacionados.
        -- La fecha debe cubrir el inicio real; no basta solapar agosto.
        (a."affiliationType" = 'trainee' AND t.id = v_team.id
          AND v_race."startDate" IS NOT NULL AND v_start IS NOT NULL AND a."dateFrom" <= v_start
          AND a."dateTo" >= COALESCE(v_end,v_start))
      )
      AND (v_start IS NULL OR a."dateTo" IS NULL OR a."dateTo" >= v_start)
  ), roster AS (
    SELECT m.id,m."firstName",m."lastName",m."otherNames",m.nationality,m."birthDate",
      m."uciProfileId",m."currentTeamId",m.verified,a."teamId" AS "rosterTeamId",a."affiliationType"
    FROM affiliations a JOIN public.riders_men m ON m.id=a."riderId" WHERE v_race.gender='male'
    UNION ALL
    SELECT w.id,w."firstName",w."lastName",w."otherNames",w.nationality,w."birthDate",
      w."uciProfileId",w."currentTeamId",w.verified,a."teamId",a."affiliationType"
    FROM affiliations a JOIN public.riders_women w ON w.id=a."riderId" WHERE v_race.gender='female'
    UNION ALL
    -- Compatibilidad solo en la temporada actual y sin historial anual del corredor.
    SELECT m.id,m."firstName",m."lastName",m."otherNames",m.nationality,m."birthDate",
      m."uciProfileId",m."currentTeamId",m.verified,t.id,'regular'::text
    FROM public.riders_men m JOIN roster_team_ids t ON t.stored_id=m."currentTeamId"
    WHERE v_race.gender='male' AND v_year=extract(year FROM current_date)::integer
      AND NOT EXISTS (SELECT 1 FROM public.rider_team_affiliations a
        WHERE a."riderId"=m.id AND a."riderGender"='male' AND a.year=v_year)
    UNION ALL
    SELECT w.id,w."firstName",w."lastName",w."otherNames",w.nationality,w."birthDate",
      w."uciProfileId",w."currentTeamId",w.verified,t.id,'regular'::text
    FROM public.riders_women w JOIN roster_team_ids t ON t.stored_id=w."currentTeamId"
    WHERE v_race.gender='female' AND v_year=extract(year FROM current_date)::integer
      AND NOT EXISTS (SELECT 1 FROM public.rider_team_affiliations a
        WHERE a."riderId"=w.id AND a."riderGender"='female' AND a.year=v_year)
  ), unique_riders AS (
    SELECT DISTINCT ON (r.id) r.*,t.name AS "rosterTeamName",v_race.gender AS gender
    FROM roster r JOIN eligible_teams t ON t.id=r."rosterTeamId"
    ORDER BY r.id,(r."rosterTeamId"=v_team.id) DESC,(r."affiliationType"='regular') DESC,r."rosterTeamId"
  ) SELECT COALESCE(jsonb_agg(to_jsonb(u) ORDER BY u."lastName",u."firstName",u.id),'[]'::jsonb)
    INTO v_roster FROM unique_riders u;
  RETURN v_roster;
END;
$function$;
