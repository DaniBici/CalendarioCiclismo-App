-- Stagiaire: vínculo individual acreditado, separado del equipo habitual.
BEGIN;
ALTER TABLE public.rider_team_affiliations
  ADD COLUMN "affiliationType" text NOT NULL DEFAULT 'regular',
  ADD COLUMN "sourceUrl" text,
  ADD COLUMN "uciTeamProfileId" integer,
  ADD COLUMN "dateBasis" text,
  ADD COLUMN "verifiedAt" timestamptz,
  ADD CONSTRAINT affiliation_type_valid CHECK ("affiliationType" IN ('regular','trainee')),
  ADD CONSTRAINT trainee_evidence_required CHECK (
    "affiliationType" <> 'trainee' OR (
      "dateFrom" IS NOT NULL AND "dateTo" IS NOT NULL
      AND "dateFrom" <= "dateTo"
      AND "dateFrom" >= make_date(year,7,1) AND "dateTo" <= make_date(year,12,31)
      AND "sourceUrl" IS NOT NULL AND "sourceUrl" ~ '^https://[^/ ]+/'
      AND "uciTeamProfileId" IS NOT NULL AND "uciTeamProfileId" > 0
      AND "verifiedAt" IS NOT NULL AND verified IS TRUE
      AND "dateBasis" IS NOT NULL AND "dateBasis" IN ('official','regulatory_window')
      AND ("dateBasis" <> 'regulatory_window'
        OR ("dateFrom" = make_date(year,8,1) AND "dateTo" = make_date(year,12,31)))
    )
  );
CREATE UNIQUE INDEX rider_trainee_host_year_unique
  ON public.rider_team_affiliations ("riderGender","riderId","teamId",year)
  WHERE "affiliationType" = 'trainee';
COMMENT ON COLUMN public.rider_team_affiliations."affiliationType" IS
  'regular: equipo habitual; trainee: prueba individual en el equipo indicado, sin relación con equipos de desarrollo.';
COMMENT ON COLUMN public.rider_team_affiliations."dateBasis" IS
  'regulatory_window: agosto–diciembre, no fechas contractuales publicadas. official: fechas documentadas; julio exige excepción reglamentaria acreditada.';

CREATE FUNCTION private.guard_trainee_affiliation()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF (TG_OP <> 'INSERT' AND OLD."affiliationType" = 'trainee')
     OR (TG_OP <> 'DELETE' AND NEW."affiliationType" = 'trainee') THEN
    IF current_user NOT IN ('postgres','supabase_admin','service_role')
       AND NOT COALESCE(private.is_admin(),false) THEN
      RAISE EXCEPTION 'Se requieren permisos de administración para vínculos de prueba' USING ERRCODE='42501';
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  IF NEW."affiliationType" <> 'trainee' THEN RETURN NEW; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.teams t WHERE t.id = NEW."teamId"
      AND NOT t."specialEdition" AND t."teamKind" <> 'selection'
      AND t.gender = NEW."riderGender"
      AND ((t.gender='male' AND t.category IN ('WT','PT','CT'))
        OR (t.gender='female' AND t.category IN ('WWT','PRW','CTW')))
  ) THEN
    RAISE EXCEPTION 'El equipo de prueba debe ser un equipo UCI canónico del mismo género' USING ERRCODE='23514';
  END IF;
  IF NOT ((NEW."riderGender"='male' AND EXISTS (SELECT 1 FROM public.riders_men WHERE id=NEW."riderId"))
       OR (NEW."riderGender"='female' AND EXISTS (SELECT 1 FROM public.riders_women WHERE id=NEW."riderId"))) THEN
    RAISE EXCEPTION 'No existe la ficha del corredor de prueba en ese género' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.guard_trainee_affiliation() FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION private.guard_trainee_affiliation() TO service_role;
CREATE TRIGGER guard_trainee_affiliation
  BEFORE INSERT OR UPDATE OR DELETE ON public.rider_team_affiliations
  FOR EACH ROW EXECUTE FUNCTION private.guard_trainee_affiliation();

CREATE OR REPLACE FUNCTION public.recompute_current_team(p_rider_id text, p_gender text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_year integer := extract(year from now())::int;
  v_team text;
BEGIN
  SELECT a."teamId" INTO v_team
  FROM public.rider_team_affiliations a
  JOIN public.teams t ON t.id = a."teamId"
  WHERE a."riderId" = p_rider_id AND a."riderGender" = p_gender AND a.year = v_year
    AND a."affiliationType" = 'regular'
    AND (a."dateFrom" IS NULL OR a."dateFrom" <= CURRENT_DATE)
    AND (a."dateTo" IS NULL OR a."dateTo" >= CURRENT_DATE)
    AND t."teamKind" <> 'selection' AND COALESCE(t.category,'') NOT IN ('NTM','NTW')
  ORDER BY (a.source = 'startlist_club'), a."dateFrom" DESC NULLS LAST,
           a."updatedAt" DESC, a.id
  LIMIT 1;

  IF p_gender = 'male' THEN
    UPDATE public.riders_men SET "currentTeamId" = v_team, "updatedAt" = now()
      WHERE id = p_rider_id AND "currentTeamId" IS DISTINCT FROM v_team;
  ELSIF p_gender = 'female' THEN
    UPDATE public.riders_women SET "currentTeamId" = v_team, "updatedAt" = now()
      WHERE id = p_rider_id AND "currentTeamId" IS DISTINCT FROM v_team;
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.sync_rider_to_affiliation()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_year   integer := extract(year from now())::int;
  v_gender text := TG_ARGV[0];
BEGIN
  -- No reaccionar cuando el que escribe currentTeamId es el INVERSO (evita bucle).
  IF pg_trigger_depth() > 1 THEN
    RETURN NEW;
  END IF;

  -- Borrar solo la afiliación habitual simple (sin fechas) del rider en el año (no solo la del
  -- id que coincidiría) → corrige el bug de colisión de id (cambio de equipo dejaba
  -- punteros obsoletos vivos).
  DELETE FROM public.rider_team_affiliations
  WHERE "riderId" = NEW.id
    AND "riderGender" = v_gender
    AND year = v_year
    AND "affiliationType" = 'regular'
    AND "dateFrom" IS NULL
    AND "dateTo" IS NULL;

  -- Insertar la nueva simple solo si tiene equipo (NULL = sin equipo → sin afiliación simple).
  IF NEW."currentTeamId" IS NOT NULL THEN
    INSERT INTO public.rider_team_affiliations (
      id, "riderId", "riderGender", "teamId", year,
      "dateFrom", "dateTo", source, verified, "createdAt", "updatedAt"
    ) VALUES (
      NEW.id || '__' || NEW."currentTeamId" || '__' || v_year,
      NEW.id, v_gender, NEW."currentTeamId", v_year,
      NULL, NULL, 'panel', COALESCE(NEW.verified, false), now(), now()
    )
    ON CONFLICT (id) DO UPDATE SET
      "teamId"    = EXCLUDED."teamId",
      verified    = EXCLUDED.verified,
      "updatedAt" = now();
  END IF;

  RETURN NEW;
END $function$;


CREATE OR REPLACE FUNCTION public.sync_affiliation_to_current_team()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF pg_trigger_depth() > 1 THEN RETURN COALESCE(NEW,OLD); END IF;
  -- Añadir, modificar o retirar una prueba no modifica el equipo habitual.
  IF TG_OP = 'DELETE' THEN
    IF OLD."affiliationType"='regular' THEN
      PERFORM public.recompute_current_team(OLD."riderId",OLD."riderGender");
    END IF;
    RETURN OLD;
  END IF;
  IF NEW."affiliationType"='regular' THEN
    PERFORM public.recompute_current_team(NEW."riderId",NEW."riderGender");
  END IF;
  IF TG_OP='UPDATE' AND OLD."affiliationType"='regular'
     AND (NEW."affiliationType"<>'regular'
       OR OLD."riderId" IS DISTINCT FROM NEW."riderId"
       OR OLD."riderGender" IS DISTINCT FROM NEW."riderGender") THEN
    PERFORM public.recompute_current_team(OLD."riderId",OLD."riderGender");
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.recompute_current_team(text,text),
  public.sync_rider_to_affiliation(),public.sync_affiliation_to_current_team()
  FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.recompute_current_team(text,text),
  public.sync_rider_to_affiliation(),public.sync_affiliation_to_current_team() TO service_role;

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
          AND v_start IS NOT NULL AND a."dateFrom" <= v_start
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

REVOKE ALL ON FUNCTION public.startlist_team_roster(text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.startlist_team_roster(text,text) TO authenticated,service_role;
COMMENT ON FUNCTION public.startlist_team_roster(text,text) IS
  'Autómatch: afiliaciones habituales según reglas existentes y stagiaires solo del equipo anfitrión durante sus fechas. No acredita elegibilidad deportiva ni modifica vínculos de desarrollo.';

CREATE FUNCTION public.upsert_rider_trainee(
  p_rider_id text,p_gender text,p_team_id text,p_year integer,
  p_date_from date,p_date_to date,p_source_url text,p_uci_team_profile_id integer,
  p_date_basis text,p_verified_at timestamptz
) RETURNS text LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_id text;
BEGIN
  IF current_user NOT IN ('postgres','supabase_admin','service_role')
     AND NOT COALESCE(private.is_admin(),false) THEN
    RAISE EXCEPTION 'Se requieren permisos de administración' USING ERRCODE='42501';
  END IF;
  INSERT INTO public.rider_team_affiliations
    (id,"riderId","riderGender","teamId",year,"affiliationType",
     "dateFrom","dateTo",source,verified,"sourceUrl","uciTeamProfileId","dateBasis","verifiedAt")
  VALUES (gen_random_uuid()::text,p_rider_id,p_gender,p_team_id,p_year,'trainee',
    p_date_from,p_date_to,'uci_trainees',true,p_source_url,p_uci_team_profile_id,p_date_basis,p_verified_at)
  ON CONFLICT ("riderGender","riderId","teamId",year) WHERE "affiliationType"='trainee'
  DO UPDATE SET "dateFrom"=EXCLUDED."dateFrom","dateTo"=EXCLUDED."dateTo",
    source=EXCLUDED.source,verified=true,"sourceUrl"=EXCLUDED."sourceUrl",
    "uciTeamProfileId"=EXCLUDED."uciTeamProfileId","dateBasis"=EXCLUDED."dateBasis",
    "verifiedAt"=EXCLUDED."verifiedAt","updatedAt"=now()
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.upsert_rider_trainee(text,text,text,integer,date,date,text,integer,text,timestamptz)
  FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.upsert_rider_trainee(text,text,text,integer,date,date,text,integer,text,timestamptz)
  TO authenticated,service_role;

-- Copia restringida y manifiesto de cada importación autorizada.
CREATE TABLE private.trainee_import_batches (
  id text PRIMARY KEY,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  snapshot jsonb NOT NULL,
  result jsonb
);
REVOKE ALL ON private.trainee_import_batches FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT,UPDATE ON private.trainee_import_batches TO service_role;
COMMIT;
