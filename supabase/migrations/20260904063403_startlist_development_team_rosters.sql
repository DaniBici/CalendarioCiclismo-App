-- Vínculos deportivos por temporada, independientes de los maillots especiales.
CREATE TABLE public.team_development_links (
  "developmentTeamId" text NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  "mainTeamId" text NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  year integer NOT NULL CHECK (year BETWEEN 1900 AND 2200),
  "sourceUrl" text NOT NULL CHECK ("sourceUrl" ~ '^https://[^[:space:]]+$'),
  "verifiedAt" timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("developmentTeamId", year),
  CHECK ("developmentTeamId" <> "mainTeamId")
);
CREATE INDEX team_development_links_main_year_idx
  ON public.team_development_links ("mainTeamId", year);
ALTER TABLE public.team_development_links ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.team_development_links FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.team_development_links TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.team_development_links TO service_role;
CREATE POLICY team_development_links_read ON public.team_development_links
  FOR SELECT TO authenticated USING ((SELECT private.is_admin()));

CREATE FUNCTION private.validate_team_development_link()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_main public.teams%ROWTYPE; v_dev public.teams%ROWTYPE;
BEGIN
  SELECT * INTO STRICT v_main FROM public.teams WHERE id = NEW."mainTeamId";
  SELECT * INTO STRICT v_dev FROM public.teams WHERE id = NEW."developmentTeamId";
  IF v_main.gender IS NULL OR v_main.gender IS DISTINCT FROM v_dev.gender
     OR v_main."specialEdition" OR v_dev."specialEdition"
     OR v_main."teamKind" = 'selection' OR v_dev."teamKind" = 'selection'
     OR v_main.category IN ('NTM','NTW') OR v_dev.category IN ('NTM','NTW') THEN
    RAISE EXCEPTION 'El vínculo requiere equipos regulares del mismo género' USING ERRCODE = '23514';
  END IF;
  -- Una filial tiene una matriz por temporada; no se admiten cadenas ni ciclos.
  PERFORM pg_catalog.pg_advisory_xact_lock(726184, NEW.year);
  IF EXISTS (SELECT 1 FROM public.team_development_links l WHERE l.year = NEW.year
    AND (l."developmentTeamId" = NEW."mainTeamId" OR l."mainTeamId" = NEW."developmentTeamId")) THEN
    RAISE EXCEPTION 'El vínculo no puede formar cadenas de filiales' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.validate_team_development_link() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.validate_team_development_link() TO service_role;
CREATE TRIGGER validate_team_development_link BEFORE INSERT OR UPDATE
  ON public.team_development_links FOR EACH ROW EXECUTE FUNCTION private.validate_team_development_link();

CREATE FUNCTION public.startlist_team_roster(p_race_id text, p_team_id text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = '' AS $$
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
  ), affiliations AS (
    SELECT a."riderId",a."teamId" FROM public.rider_team_affiliations a
    JOIN eligible_teams t ON t.id = a."teamId"
    WHERE a.year = v_year AND a."riderGender" = v_race.gender
      AND (v_end IS NULL OR a."dateFrom" IS NULL OR a."dateFrom" <= v_end)
      AND (v_start IS NULL OR a."dateTo" IS NULL OR a."dateTo" >= v_start)
  ), roster AS (
    SELECT m.id,m."firstName",m."lastName",m."otherNames",m.nationality,m."birthDate",
      m."uciProfileId",m."currentTeamId",m.verified,a."teamId" AS "rosterTeamId"
    FROM affiliations a JOIN public.riders_men m ON m.id=a."riderId" WHERE v_race.gender='male'
    UNION ALL
    SELECT w.id,w."firstName",w."lastName",w."otherNames",w.nationality,w."birthDate",
      w."uciProfileId",w."currentTeamId",w.verified,a."teamId"
    FROM affiliations a JOIN public.riders_women w ON w.id=a."riderId" WHERE v_race.gender='female'
    UNION ALL
    -- Compatibilidad solo en la temporada actual y sin historial anual del corredor.
    SELECT m.id,m."firstName",m."lastName",m."otherNames",m.nationality,m."birthDate",
      m."uciProfileId",m."currentTeamId",m.verified,m."currentTeamId"
    FROM public.riders_men m JOIN eligible_teams t ON t.id=m."currentTeamId"
    WHERE v_race.gender='male' AND v_year=extract(year FROM current_date)::integer
      AND NOT EXISTS (SELECT 1 FROM public.rider_team_affiliations a
        WHERE a."riderId"=m.id AND a."riderGender"='male' AND a.year=v_year)
    UNION ALL
    SELECT w.id,w."firstName",w."lastName",w."otherNames",w.nationality,w."birthDate",
      w."uciProfileId",w."currentTeamId",w.verified,w."currentTeamId"
    FROM public.riders_women w JOIN eligible_teams t ON t.id=w."currentTeamId"
    WHERE v_race.gender='female' AND v_year=extract(year FROM current_date)::integer
      AND NOT EXISTS (SELECT 1 FROM public.rider_team_affiliations a
        WHERE a."riderId"=w.id AND a."riderGender"='female' AND a.year=v_year)
  ), unique_riders AS (
    SELECT DISTINCT ON (r.id) r.*,t.name AS "rosterTeamName",v_race.gender AS gender
    FROM roster r JOIN eligible_teams t ON t.id=r."rosterTeamId"
    ORDER BY r.id,(r."rosterTeamId"=v_team.id) DESC,r."rosterTeamId"
  ) SELECT COALESCE(jsonb_agg(to_jsonb(u) ORDER BY u."lastName",u."firstName",u.id),'[]'::jsonb)
    INTO v_roster FROM unique_riders u;
  RETURN v_roster;
END;
$$;
REVOKE ALL ON FUNCTION public.startlist_team_roster(text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.startlist_team_roster(text,text) TO authenticated, service_role;
COMMENT ON FUNCTION public.startlist_team_roster(text,text) IS
  'Plantillas para autocompletar inscritos: equipo y vínculos matriz/filial directos del año, con afiliaciones válidas en la carrera. Solo lectura; no acredita elegibilidad deportiva.';

-- Relaciones verificadas en la tabla UCI del 20-03-2026 (página 3).
-- Los nombres son los canónicos actuales: INEOS, Canyon y UAE femenino
-- conservan la identidad de la temporada bajo sus denominaciones nuevas.
DO $$
DECLARE
  v_pair record; v_main_id text; v_dev_id text;
  v_source constant text := 'https://assets.ctfassets.net/761l7gh5x5an/3EjeIEEJpI38fDQOoc54AI/a0a1b2a14930864325e7c0ec17a9b72d/Article2.2.001_Participation_Equipes_2026_20032026.pdf';
BEGIN
  FOR v_pair IN SELECT * FROM (VALUES
    ('male','Alpecin-Premier Tech','Alpecin-Premier Tech Development'),
    ('male','Bahrain Victorious','Bahrain Victorious Development'),
    ('male','Decathlon CMA CGM','Decathlon CMA CGM Development'),
    ('male','EF Education-EasyPost','EF Education-Aevolo'),
    ('male','Groupama-FDJ United','Groupama-FDJ United CT'),
    ('male','Netcompany INEOS','INEOS Grenadiers Racing Academy'),
    ('male','Lidl-Trek','Lidl-Trek Future Racing'),
    ('male','Lotto Intermarché','Lotto - Groupe Wanty'),
    ('male','Movistar','Movistar Academy'),
    ('male','NSN','NSN Development'),
    ('male','Red Bull-BORA-hansgrohe','Red Bull-BORA-hansgrohe Rookies'),
    ('male','Soudal Quick-Step','Soudal Quick-Step Devo'),
    ('male','Jayco Alula','Hagens Berman Jayco'),
    ('male','Picnic PostNL','Development Team Picnic PostNL'),
    ('male','Visma | Lease a Bike','Visma | Lease a Bike Development'),
    ('male','UAE Team Emirates-XRG','UAE Team Emirates Gen-Z'),
    ('male','XDS Astana','XDS Astana Development'),
    ('male','Kern Pharma','Equipo Finisher'),
    ('male','Euskaltel-Euskadi','BBK-Euskadi Fundazioa'),
    ('male','Solution Tech Nippo Rali','Team Nippo Nuovacomauto Obor'),
    ('male','Novo Nordisk','Team Novo Nordisk Development'),
    ('male','TotalEnergies','Vendée U Primeo Energie'),
    ('male','Tudor','Tudor U23'),
    ('female','AG Insurance-Soudal','AG Insurance-Soudal Development'),
    ('female','Canyon//SRAM','Canyon//SRAM Generation'),
    ('female','Fenix-Premier Tech','Fenix-Premier Tech Development'),
    ('female','Liv AlUla Jayco','Liv AlUla Jayco Continental'),
    ('female','UAE Team L''IMAD','UAE Development Team')
  ) AS pairs(gender,main_name,dev_name) LOOP
    SELECT id INTO STRICT v_main_id FROM public.teams
      WHERE gender=v_pair.gender AND name=v_pair.main_name AND NOT "specialEdition";
    SELECT id INTO STRICT v_dev_id FROM public.teams
      WHERE gender=v_pair.gender AND name=v_pair.dev_name AND NOT "specialEdition";
    INSERT INTO public.team_development_links("developmentTeamId","mainTeamId",year,"sourceUrl")
      VALUES(v_dev_id,v_main_id,2026,v_source);
  END LOOP;
END;
$$;
