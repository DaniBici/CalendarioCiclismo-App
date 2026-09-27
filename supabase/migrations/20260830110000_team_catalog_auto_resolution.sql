-- Catálogo de equipos por alias y resolución obligatoria en startlists.
-- El ámbito actual de datos deportivos es la temporada 2026. La función usa
-- races.year para conservar el mismo contrato cuando se incorpore otra temporada.

ALTER TABLE public.teams
  ADD COLUMN IF NOT EXISTS "teamKind" text,
  ADD COLUMN IF NOT EXISTS "selectionScope" text,
  ADD COLUMN IF NOT EXISTS "selectionCode" text;

UPDATE public.teams
SET "teamKind" = CASE WHEN category IN ('NTM', 'NTW') THEN 'selection' ELSE 'club' END
WHERE "teamKind" IS NULL;

UPDATE public.teams
SET "selectionScope" = 'national',
    "selectionCode" = COALESCE("selectionCode", "countryCode")
WHERE category IN ('NTM', 'NTW')
  AND "selectionScope" IS NULL;

ALTER TABLE public.teams
  ALTER COLUMN "teamKind" SET DEFAULT 'club',
  ALTER COLUMN "teamKind" SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'teams_team_kind_ck_20260830'
  ) THEN
    ALTER TABLE public.teams
      ADD CONSTRAINT teams_team_kind_ck_20260830
      CHECK ("teamKind" IN ('club', 'selection'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'teams_selection_scope_ck_20260830'
  ) THEN
    ALTER TABLE public.teams
      ADD CONSTRAINT teams_selection_scope_ck_20260830
      CHECK ("selectionScope" IS NULL OR "selectionScope" IN ('national', 'regional'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'teams_selection_kind_scope_ck_20260830'
  ) THEN
    ALTER TABLE public.teams
      ADD CONSTRAINT teams_selection_kind_scope_ck_20260830
      CHECK ("teamKind" = 'selection' OR "selectionScope" IS NULL);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_teams_kind_scope
  ON public.teams ("teamKind", "selectionScope");

CREATE TABLE IF NOT EXISTS public.team_name_aliases (
  id text PRIMARY KEY,
  "teamId" text NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  alias text NOT NULL,
  "foldedName" text NOT NULL,
  year smallint NOT NULL DEFAULT 2026,
  source text NOT NULL DEFAULT 'manual',
  "sourceUrl" text,
  verified boolean NOT NULL DEFAULT false,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now(),
  UNIQUE ("teamId", "foldedName", year)
);

CREATE INDEX IF NOT EXISTS idx_team_name_aliases_lookup
  ON public.team_name_aliases ("foldedName", year);

CREATE TABLE IF NOT EXISTS public.team_selection_aliases (
  id text PRIMARY KEY,
  name text NOT NULL,
  "foldedName" text NOT NULL UNIQUE,
  "selectionScope" text NOT NULL CHECK ("selectionScope" IN ('national', 'regional')),
  "countryCode" text,
  "selectionCode" text,
  source text NOT NULL DEFAULT 'curated',
  "sourceUrl" text,
  verified boolean NOT NULL DEFAULT false,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_team_selection_aliases_code
  ON public.team_selection_aliases ("selectionCode");

-- Las selecciones ya catalogadas aportan el primer diccionario de nombres.
INSERT INTO public.team_selection_aliases
  (id, name, "foldedName", "selectionScope", "countryCode", "selectionCode", source, verified)
SELECT
  'tsa_catalog_' || md5(t.id || '|' || x.alias),
  x.alias,
  public.fold_team_name(x.alias),
  'national',
  t."countryCode",
  COALESCE(t."selectionCode", t."countryCode"),
  'catalog_backfill',
  true
FROM public.teams t
CROSS JOIN LATERAL unnest(
  ARRAY[t.name] || COALESCE(string_to_array(t."nameAliases", E'\n'), ARRAY[]::text[])
) AS x(alias)
WHERE t.category IN ('NTM', 'NTW')
  AND t."specialEdition" IS NOT TRUE
  AND public.fold_team_name(x.alias) IS NOT NULL
ON CONFLICT ("foldedName") DO NOTHING;

-- Diccionario base ampliable para selecciones aún no presentes en teams y para
-- selecciones regionales tratadas como NTM/NTW. Los aliases no crean equipos por
-- sí solos: solo determinan la categoría de una alta automática.
INSERT INTO public.team_selection_aliases
  (id, name, "foldedName", "selectionScope", "countryCode", "selectionCode", source, verified)
SELECT
  'tsa_seed_' || code,
  name,
  public.fold_team_name(name),
  scope,
  country_code,
  code,
  'catalog_rule',
  true
FROM (VALUES
  ('ad', 'Andorra', 'national', 'ad'), ('al', 'Albania', 'national', 'al'),
  ('ar', 'Argentina', 'national', 'ar'), ('at', 'Austria', 'national', 'at'),
  ('au', 'Australia', 'national', 'au'), ('be', 'Belgium', 'national', 'be'),
  ('br', 'Brazil', 'national', 'br'), ('bg', 'Bulgaria', 'national', 'bg'),
  ('ca', 'Canada', 'national', 'ca'), ('ch', 'Switzerland', 'national', 'ch'),
  ('cl', 'Chile', 'national', 'cl'), ('cn', 'China', 'national', 'cn'),
  ('co', 'Colombia', 'national', 'co'), ('cr', 'Costa Rica', 'national', 'cr'),
  ('hr', 'Croatia', 'national', 'hr'), ('cz', 'Czech Republic', 'national', 'cz'),
  ('dk', 'Denmark', 'national', 'dk'), ('ec', 'Ecuador', 'national', 'ec'),
  ('ee', 'Estonia', 'national', 'ee'), ('fi', 'Finland', 'national', 'fi'),
  ('fr', 'France', 'national', 'fr'), ('gb', 'Great Britain', 'national', 'gb'),
  ('de', 'Germany', 'national', 'de'), ('gr', 'Greece', 'national', 'gr'),
  ('gt', 'Guatemala', 'national', 'gt'), ('hu', 'Hungary', 'national', 'hu'),
  ('id', 'Indonesia', 'national', 'id'), ('ie', 'Ireland', 'national', 'ie'),
  ('il', 'Israel', 'national', 'il'), ('in', 'India', 'national', 'in'),
  ('it', 'Italy', 'national', 'it'), ('jp', 'Japan', 'national', 'jp'),
  ('kz', 'Kazakhstan', 'national', 'kz'), ('lt', 'Lithuania', 'national', 'lt'),
  ('lu', 'Luxembourg', 'national', 'lu'), ('lv', 'Latvia', 'national', 'lv'),
  ('my', 'Malaysia', 'national', 'my'), ('mx', 'Mexico', 'national', 'mx'),
  ('ma', 'Morocco', 'national', 'ma'), ('nl', 'Netherlands', 'national', 'nl'),
  ('nz', 'New Zealand', 'national', 'nz'), ('no', 'Norway', 'national', 'no'),
  ('pl', 'Poland', 'national', 'pl'), ('pt', 'Portugal', 'national', 'pt'),
  ('ro', 'Romania', 'national', 'ro'), ('ru', 'Russia', 'national', 'ru'),
  ('rs', 'Serbia', 'national', 'rs'), ('sk', 'Slovakia', 'national', 'sk'),
  ('si', 'Slovenia', 'national', 'si'), ('za', 'South Africa', 'national', 'za'),
  ('kr', 'South Korea', 'national', 'kr'), ('es', 'Spain', 'national', 'es'),
  ('se', 'Sweden', 'national', 'se'), ('th', 'Thailand', 'national', 'th'),
  ('tr', 'Turkey', 'national', 'tr'), ('ua', 'Ukraine', 'national', 'ua'),
  ('us', 'United States', 'national', 'us'), ('uy', 'Uruguay', 'national', 'uy'),
  ('uz', 'Uzbekistan', 'national', 'uz'), ('ve', 'Venezuela', 'national', 've'),
  ('vn', 'Vietnam', 'national', 'vn'),
  ('es-es', 'España', 'national', 'es'),
  ('de-de', 'Alemania', 'national', 'de'),
  ('it-it', 'Italia', 'national', 'it'),
  ('nl-nl', 'Países Bajos', 'national', 'nl'),
  ('be-be', 'Bélgica', 'national', 'be'),
  ('ch-ch', 'Suiza', 'national', 'ch'),
  ('dk-dk', 'Dinamarca', 'national', 'dk'),
  ('se-se', 'Suecia', 'national', 'se'),
  ('no-no', 'Noruega', 'national', 'no'),
  ('fi-fi', 'Finlandia', 'national', 'fi'),
  ('pl-pl', 'Polonia', 'national', 'pl'),
  ('pt-pt', 'Portugal', 'national', 'pt'),
  ('cz-cz', 'República Checa', 'national', 'cz'),
  ('gb-gb', 'Gran Bretaña', 'national', 'gb'),
  ('us-us', 'Estados Unidos', 'national', 'us'),
  ('ca-ca', 'Canadá', 'national', 'ca'),
  ('mx-mx', 'México', 'national', 'mx'),
  ('br-br', 'Brasil', 'national', 'br'),
  ('ar-ar', 'Argentina', 'national', 'ar'),
  ('cl-cl', 'Chile', 'national', 'cl'),
  ('co-co', 'Colombia', 'national', 'co'),
  ('ec-ec', 'Ecuador', 'national', 'ec'),
  ('za-za', 'Sudáfrica', 'national', 'za'),
  ('au-au', 'Australia', 'national', 'au'),
  ('nz-nz', 'Nueva Zelanda', 'national', 'nz'),
  ('jp-jp', 'Japón', 'national', 'jp'),
  ('cn-cn', 'China', 'national', 'cn'),
  ('kr-kr', 'Corea del Sur', 'national', 'kr'),
  ('kz-kz', 'Kazajistán', 'national', 'kz'),
  ('tr-tr', 'Turquía', 'national', 'tr'),
  ('ua-ua', 'Ucrania', 'national', 'ua'),
  ('es-ct', 'Catalunya', 'regional', 'es'),
  ('es-pv', 'País Vasco', 'regional', 'es'),
  ('es-gal', 'Galicia', 'regional', 'es'),
  ('es-ast', 'Asturias', 'regional', 'es'),
  ('es-and', 'Andalusia', 'regional', 'es'),
  ('euskadi', 'Euskadi', 'regional', 'es'),
  ('catalonia', 'Catalonia', 'regional', 'es'),
  ('bretagne', 'Bretagne', 'regional', 'fr'),
  ('normandie', 'Normandie', 'regional', 'fr'),
  ('flanders', 'Flanders', 'regional', 'be'),
  ('wallonia', 'Wallonia', 'regional', 'be'),
  ('scotland', 'Scotland', 'regional', 'gb'),
  ('wales', 'Wales', 'regional', 'gb'),
  ('england', 'England', 'regional', 'gb'),
  ('lombardia', 'Lombardia', 'regional', 'it'),
  ('toscana', 'Toscana', 'regional', 'it'),
  ('sicilia', 'Sicilia', 'regional', 'it'),
  ('veneto', 'Veneto', 'regional', 'it')
) AS seed(code, name, scope, country_code)
ON CONFLICT ("foldedName") DO NOTHING;

-- Las denominaciones regionales tienen prioridad sobre un alias histórico que
-- pudo haber sido catalogado antes como selección nacional genérica.
UPDATE public.team_selection_aliases tsa
SET "selectionScope" = seed.scope,
    "countryCode" = seed.country_code,
    "selectionCode" = seed.code,
    source = 'catalog_rule',
    verified = true,
    "updatedAt" = now()
FROM (VALUES
  ('es-ct', 'Catalunya', 'regional', 'es'),
  ('es-pv', 'País Vasco', 'regional', 'es'),
  ('es-gal', 'Galicia', 'regional', 'es'),
  ('es-ast', 'Asturias', 'regional', 'es'),
  ('es-and', 'Andalusia', 'regional', 'es'),
  ('euskadi', 'Euskadi', 'regional', 'es'),
  ('catalonia', 'Catalonia', 'regional', 'es'),
  ('bretagne', 'Bretagne', 'regional', 'fr'),
  ('normandie', 'Normandie', 'regional', 'fr'),
  ('flanders', 'Flanders', 'regional', 'be'),
  ('wallonia', 'Wallonia', 'regional', 'be'),
  ('scotland', 'Scotland', 'regional', 'gb'),
  ('wales', 'Wales', 'regional', 'gb'),
  ('england', 'England', 'regional', 'gb'),
  ('lombardia', 'Lombardia', 'regional', 'it'),
  ('toscana', 'Toscana', 'regional', 'it'),
  ('sicilia', 'Sicilia', 'regional', 'it'),
  ('veneto', 'Veneto', 'regional', 'it')
) AS seed(code, name, scope, country_code)
WHERE tsa."foldedName" = public.fold_team_name(seed.name);

-- Alias histórico de todos los equipos canónicos no especiales. No se impone
-- unicidad global sobre foldedName: dos entidades pueden compartir denominación.
INSERT INTO public.team_name_aliases
  (id, "teamId", alias, "foldedName", year, source, verified)
SELECT
  'tna_catalog_' || md5(t.id || '|2026|' || public.fold_team_name(x.alias)),
  t.id,
  x.alias,
  public.fold_team_name(x.alias),
  2026,
  'catalog_backfill',
  true
FROM public.teams t
CROSS JOIN LATERAL unnest(
  ARRAY[t.name] || COALESCE(string_to_array(t."nameAliases", E'\n'), ARRAY[]::text[])
) AS x(alias)
WHERE t."specialEdition" IS NOT TRUE
  AND public.fold_team_name(x.alias) IS NOT NULL
ON CONFLICT ("teamId", "foldedName", year) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.team_link_decisions (
  id text PRIMARY KEY,
  "raceId" text NOT NULL REFERENCES public.races(id) ON DELETE CASCADE,
  "occurrenceType" text NOT NULL CHECK ("occurrenceType" IN ('startlist_team', 'race_uci_result')),
  "occurrenceId" text NOT NULL,
  "rawName" text NOT NULL,
  "foldedName" text NOT NULL,
  "teamId" text REFERENCES public.teams(id) ON DELETE SET NULL,
  action text NOT NULL CHECK (action IN ('provided', 'reused', 'created', 'ignored', 'ambiguous', 'pending')),
  "matchMethod" text NOT NULL,
  source text NOT NULL DEFAULT 'startlist_auto',
  "sourceUrl" text,
  year smallint NOT NULL DEFAULT 2026,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now(),
  UNIQUE ("occurrenceType", "occurrenceId")
);

CREATE INDEX IF NOT EXISTS idx_team_link_decisions_race
  ON public.team_link_decisions ("raceId", "occurrenceType");

CREATE OR REPLACE FUNCTION public.ensure_startlist_team(
  p_race_id text,
  p_team_name text,
  p_team_gender text DEFAULT NULL
)
RETURNS TABLE (team_id text, action text, team_kind text, selection_scope text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_name text := NULLIF(btrim(p_team_name), '');
  v_fold text;
  v_year smallint;
  v_race_gender text;
  v_gender text;
  v_race_url text;
  v_kind text := 'club';
  v_scope text;
  v_selection_code text;
  v_country_code text;
  v_category text;
  v_team_id text;
  v_candidates text[];
  v_inserted boolean := false;
BEGIN
  IF v_name IS NULL THEN
    RETURN QUERY SELECT NULL::text, 'pending', 'club', NULL::text;
    RETURN;
  END IF;

  IF lower(v_name) = 'individual' THEN
    RETURN QUERY SELECT NULL::text, 'ignored', 'club', NULL::text;
    RETURN;
  END IF;

  SELECT COALESCE(rc."year", 2026)::smallint, rc.gender, rc."websiteUrl"
  INTO v_year, v_race_gender, v_race_url
  FROM public.races rc
  WHERE rc.id = p_race_id;

  v_gender := CASE
    WHEN COALESCE(p_team_gender, v_race_gender) IN ('male', 'female')
      THEN COALESCE(p_team_gender, v_race_gender)
    ELSE NULL
  END;
  v_fold := public.fold_team_name(v_name);

  SELECT tsa."selectionScope", tsa."selectionCode", tsa."countryCode"
  INTO v_scope, v_selection_code, v_country_code
  FROM public.team_selection_aliases tsa
  WHERE tsa."foldedName" = v_fold
  LIMIT 1;

  IF v_scope IS NOT NULL THEN
    v_kind := 'selection';
  ELSIF lower(v_name) ~ '(regional|region|province|comunidad|county|state|euskadi|catalunya|catalonia|bretagne|normandie|flanders|wallonia)' THEN
    v_kind := 'selection';
    v_scope := 'regional';
  ELSIF lower(v_name) ~ '(national|selection|seleccion|sélection|equipe nationale)' THEN
    v_kind := 'selection';
    v_scope := 'national';
  END IF;

  IF v_kind = 'selection' THEN
    v_category := CASE WHEN v_gender = 'female' THEN 'NTW' WHEN v_gender = 'male' THEN 'NTM' ELSE NULL END;
  ELSE
    v_category := CASE WHEN v_gender = 'female' THEN 'CLUBW' WHEN v_gender = 'male' THEN 'CLUBM' ELSE NULL END;
  END IF;

  SELECT array_agg(DISTINCT t.id ORDER BY t.id)
  INTO v_candidates
  FROM public.teams t
  LEFT JOIN public.team_name_aliases a
    ON a."teamId" = t.id
   AND a.year = v_year
   AND a."foldedName" = v_fold
  WHERE t."specialEdition" IS NOT TRUE
    AND (t.gender IS NULL OR v_gender IS NULL OR t.gender = v_gender)
    AND t."teamKind" = v_kind
    AND (
      a.id IS NOT NULL
      OR public.fold_team_name(t.name) = v_fold
      OR v_fold = ANY(t."foldedNames")
    );

  IF COALESCE(array_length(v_candidates, 1), 0) > 1 THEN
    RETURN QUERY SELECT NULL::text, 'ambiguous', v_kind, v_scope;
    RETURN;
  END IF;

  IF COALESCE(array_length(v_candidates, 1), 0) = 1 THEN
    v_team_id := v_candidates[1];
    action := 'reused';
  ELSE
    IF v_kind = 'selection'
       AND v_scope = 'national'
       AND v_selection_code ~ '^[a-z]{2}$'
       AND v_gender IN ('male', 'female') THEN
      v_team_id := CASE WHEN v_gender = 'female' THEN 'team_ntw_' ELSE 'team_ntm_' END
        || COALESCE(NULLIF(regexp_replace(v_fold, '[^a-z0-9]+', '_', 'g'), ''), v_selection_code);
    ELSE
      v_team_id := 'team_auto_' || md5(
        COALESCE(v_year::text, '2026') || '|' || v_kind || '|' ||
        COALESCE(v_gender, '') || '|' || COALESCE(v_scope, '') || '|' ||
        COALESCE(v_selection_code, '') || '|' || COALESCE(v_fold, v_name)
      );
    END IF;
    INSERT INTO public.teams (
      id, name, category, gender, "countryCode", "teamKind",
      "selectionScope", "selectionCode"
    ) VALUES (
      v_team_id, v_name, v_category, v_gender, v_country_code, v_kind,
      v_scope, v_selection_code
    )
    ON CONFLICT (id) DO NOTHING;
    v_inserted := FOUND;
    action := CASE WHEN v_inserted THEN 'created' ELSE 'reused' END;
  END IF;

  INSERT INTO public.team_name_aliases (
    id, "teamId", alias, "foldedName", year, source, "sourceUrl", verified
  ) VALUES (
    'tna_auto_' || md5(v_team_id || '|' || v_year::text || '|' || v_fold),
    v_team_id, v_name, v_fold, v_year, 'startlist_auto', v_race_url, false
  )
  ON CONFLICT ("teamId", "foldedName", year) DO UPDATE SET
    alias = EXCLUDED.alias,
    "sourceUrl" = COALESCE(EXCLUDED."sourceUrl", public.team_name_aliases."sourceUrl"),
    "updatedAt" = now();

  team_id := v_team_id;
  team_kind := v_kind;
  selection_scope := v_scope;
  RETURN NEXT;
END;
$$;

COMMENT ON FUNCTION public.ensure_startlist_team(text, text, text) IS
  'Resuelve o crea el equipo de una fila de startlist para la temporada de la carrera. '
  'Acepta clubes, selecciones nacionales y regionales (NTM/NTW); conserva aliases y no crea corredores.';

CREATE OR REPLACE FUNCTION public.auto_link_startlist_team()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_resolution record;
  v_team record;
  v_race record;
  v_action text := 'provided';
  v_method text := 'caller';
BEGIN
  IF public.fold_team_name(NEW."teamName") = 'individual' THEN
    RETURN NEW;
  END IF;

  IF NEW."teamId" IS NULL THEN
    SELECT * INTO v_resolution
    FROM public.ensure_startlist_team(NEW."raceId", NEW."teamName", NULL);
    IF v_resolution.action = 'ambiguous' THEN
      RAISE EXCEPTION 'Equipo ambiguo para «%» en la carrera %; selecciona un teamId existente',
        NEW."teamName", NEW."raceId";
    END IF;
    IF v_resolution.team_id IS NULL THEN
      RAISE EXCEPTION 'No se pudo resolver el equipo «%» en la carrera %',
        NEW."teamName", NEW."raceId";
    END IF;
    NEW."teamId" := v_resolution.team_id;
    v_action := v_resolution.action;
    v_method := 'startlist_exact_or_auto';
  END IF;

  SELECT t.id, t.name, t.gender
  INTO v_team
  FROM public.teams t
  WHERE t.id = NEW."teamId";

  SELECT rc.id, rc.gender, rc."year", rc."websiteUrl"
  INTO v_race
  FROM public.races rc
  WHERE rc.id = NEW."raceId";

  IF v_team.gender IS NOT NULL
     AND v_race.gender IS NOT NULL
     AND v_team.gender <> v_race.gender THEN
    RAISE EXCEPTION 'Equipo «%» (%s) incompatible con el género %s de la carrera %s',
      v_team.name, v_team.gender, v_race.gender, v_race.id;
  END IF;

  INSERT INTO public.team_link_decisions (
    id, "raceId", "occurrenceType", "occurrenceId", "rawName", "foldedName",
    "teamId", action, "matchMethod", source, "sourceUrl", year
  ) VALUES (
    'tld_' || md5('startlist_team|' || NEW.id),
    NEW."raceId", 'startlist_team', NEW.id, NEW."teamName",
    public.fold_team_name(NEW."teamName"), NEW."teamId", v_action, v_method,
    'startlist_auto', v_race."websiteUrl", COALESCE(v_race."year", 2026)
  )
  ON CONFLICT ("occurrenceType", "occurrenceId") DO UPDATE SET
    "teamId" = EXCLUDED."teamId",
    action = EXCLUDED.action,
    "matchMethod" = EXCLUDED."matchMethod",
    "sourceUrl" = EXCLUDED."sourceUrl",
    "updatedAt" = now();

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS auto_link_startlist_team_trg ON public.startlist_teams;
CREATE TRIGGER auto_link_startlist_team_trg
  BEFORE INSERT OR UPDATE OF "teamId", "teamName", "raceId"
  ON public.startlist_teams
  FOR EACH ROW
  EXECUTE FUNCTION public.auto_link_startlist_team();

COMMENT ON FUNCTION public.auto_link_startlist_team() IS
  'Garantiza que toda nueva fila startlist_teams tenga teamId, salvo el placeholder Individual; '
  'rechaza incompatibilidades de género y registra la decisión por ocurrencia.';

ALTER TABLE public.team_name_aliases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.team_selection_aliases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.team_link_decisions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS team_name_aliases_public_read ON public.team_name_aliases;
DROP POLICY IF EXISTS team_selection_aliases_public_read ON public.team_selection_aliases;
DROP POLICY IF EXISTS team_selection_aliases_service_write ON public.team_selection_aliases;
DROP POLICY IF EXISTS team_link_decisions_authenticated_read ON public.team_link_decisions;

CREATE POLICY team_name_aliases_public_read
  ON public.team_name_aliases FOR SELECT TO anon, authenticated USING (true);

CREATE POLICY team_selection_aliases_public_read
  ON public.team_selection_aliases FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY team_selection_aliases_service_write
  ON public.team_selection_aliases FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY team_link_decisions_authenticated_read
  ON public.team_link_decisions FOR SELECT TO authenticated USING (true);

REVOKE ALL ON TABLE public.team_name_aliases, public.team_selection_aliases,
  public.team_link_decisions FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.team_name_aliases, public.team_selection_aliases
  TO anon, authenticated, service_role;
GRANT INSERT, UPDATE, DELETE ON TABLE public.team_name_aliases TO service_role;
GRANT SELECT ON TABLE public.team_link_decisions TO authenticated, service_role;
GRANT INSERT, UPDATE ON TABLE public.team_link_decisions TO service_role;

REVOKE ALL ON FUNCTION public.ensure_startlist_team(text, text, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ensure_startlist_team(text, text, text)
  TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.auto_link_startlist_team() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.auto_link_startlist_team() TO service_role;
