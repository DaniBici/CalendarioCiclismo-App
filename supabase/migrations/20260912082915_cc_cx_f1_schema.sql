-- CC-CX F1. Modelo independiente de carretera; no carga datos ni activa workers.
-- X2O usa segundos (corrección autorizada durante F1); bonusPoints permanece.

CREATE TABLE public.cx_tournaments (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  name text NOT NULL CHECK (btrim(name) <> ''),
  "nameEn" text,
  slug text NOT NULL UNIQUE CHECK (btrim(slug) <> ''),
  "seasonKey" text NOT NULL CHECK ("seasonKey" ~ '^[0-9]{4}-[0-9]{2}$'
    AND right("seasonKey",2)::int = (left("seasonKey",4)::int + 1) % 100),
  "colorHex" text CHECK ("colorHex" ~ '^#[0-9A-Fa-f]{6}$'),
  "logoUrl" text,
  translations jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(translations) = 'object'),
  "pointsScheme" jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof("pointsScheme") = 'object'),
  "updatedAt" timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, "seasonKey")
);

CREATE TABLE public.cx_teams (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  name text NOT NULL CHECK (btrim(name) <> ''),
  "nameAliases" text[] NOT NULL DEFAULT ARRAY[]::text[],
  gender text NOT NULL DEFAULT 'mixed' CHECK (gender IN ('male','female','mixed')),
  "countryCode" text CHECK ("countryCode" ~ '^[A-Z]{2}$'),
  "uciCode" text NOT NULL CHECK ("uciCode" ~ '^[A-Z0-9]{3}$'),
  "colorHex" text NOT NULL CHECK ("colorHex" ~ '^#[0-9A-Fa-f]{6}$')
  -- Color de texto calculado por contraste en clientes, no editable/persistido.
);

CREATE TABLE public.cx_riders_men (
  id text PRIMARY KEY CHECK (btrim(id) <> ''), -- slug de corredor, como carretera
  "firstName" text NOT NULL,
  "lastName" text NOT NULL,
  "otherNames" text,
  nationality text CHECK (nationality ~ '^[A-Z]{2}$'),
  "birthDate" date,
  "currentTeamId" text REFERENCES public.cx_teams(id) ON DELETE SET NULL,
  source text NOT NULL DEFAULT 'manual',
  verified boolean NOT NULL DEFAULT true,
  "uciProfileId" text,
  "uciLicenseId" text CHECK ("uciLicenseId" ~ '^[0-9]{11}$'),
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.cx_riders_women (
  id text PRIMARY KEY CHECK (btrim(id) <> ''),
  "firstName" text NOT NULL,
  "lastName" text NOT NULL,
  "otherNames" text,
  nationality text CHECK (nationality ~ '^[A-Z]{2}$'),
  "birthDate" date,
  "currentTeamId" text REFERENCES public.cx_teams(id) ON DELETE SET NULL,
  source text NOT NULL DEFAULT 'manual',
  verified boolean NOT NULL DEFAULT true,
  "uciProfileId" text,
  "uciLicenseId" text CHECK ("uciLicenseId" ~ '^[0-9]{11}$'),
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.cx_races (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  name text NOT NULL CHECK (btrim(name) <> ''),
  "nameEn" text,
  abbrev text,
  slug text NOT NULL UNIQUE CHECK (btrim(slug) <> ''),
  "slugEn" text UNIQUE CHECK (btrim("slugEn") <> ''),
  "seasonKey" text NOT NULL,
  "seasonStartYear" int NOT NULL CHECK ("seasonStartYear" BETWEEN 1900 AND 9998),
  "dateKey" date NOT NULL,
  "endDateKey" date CHECK ("endDateKey" >= "dateKey"),
  class text NOT NULL CHECK (class IN ('CM','CDM','CC','C1','C2','CN','NAC')),
  "countryCode" text CHECK ("countryCode" ~ '^[A-Z]{2}$'),
  venue text,
  "websiteUrl" text,
  "tournamentId" text,
  "colorHex" text CHECK ("colorHex" ~ '^#[0-9A-Fa-f]{6}$'),
  "logoUrl" text,
  "isCancelled" boolean NOT NULL DEFAULT false,
  "editorialStatus" text NOT NULL DEFAULT 'published' CHECK ("editorialStatus" IN ('draft','published')),
  timezone text, -- NULL hasta verificar zona IANA del lugar; no inferir por país
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  CHECK ("seasonKey" = "seasonStartYear"::text || '-' || lpad((("seasonStartYear"+1)%100)::text,2,'0')),
  FOREIGN KEY ("tournamentId","seasonKey") REFERENCES public.cx_tournaments(id,"seasonKey")
);

CREATE TABLE public.cx_race_categories (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "raceId" text NOT NULL REFERENCES public.cx_races(id) ON DELETE CASCADE,
  category text NOT NULL CHECK (category IN ('ME','WE','MU','WU','MJ','WJ')),
  "startTimeUtc" timestamptz,
  "dateKey" date,
  "sortOrder" int NOT NULL DEFAULT 0,
  "isCancelled" boolean NOT NULL DEFAULT false,
  "resultsStatus" text NOT NULL DEFAULT 'pending' CHECK ("resultsStatus" IN ('pending','provisional','official')),
  "resultsImportedAt" timestamptz,
  "startlistImportedAt" timestamptz,
  "winnerName" text,
  UNIQUE ("raceId",category)
);

CREATE TABLE public.cx_broadcasts (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "raceId" text NOT NULL REFERENCES public.cx_races(id) ON DELETE CASCADE,
  category text,
  channel text,
  "startTimeUtc" timestamptz,
  url text,
  note text,
  country text CHECK (country IN ('ALL','ES','EUROPA','PT','FR','BE','NL','IT','DE_AT_CH','UK_IE','SCANDI','EE','LATAM','NORTEAM','ASIAPAC','AFRICA','MENA')),
  "sortOrder" int NOT NULL DEFAULT 0,
  "showInRevive" boolean NOT NULL DEFAULT false,
  "isSporza" boolean NOT NULL DEFAULT false,
  FOREIGN KEY ("raceId",category) REFERENCES public.cx_race_categories("raceId",category) ON DELETE CASCADE
);

CREATE TABLE public.cx_videos (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "raceId" text NOT NULL REFERENCES public.cx_races(id) ON DELETE CASCADE,
  category text,
  title text NOT NULL,
  url text NOT NULL,
  "sortOrder" int NOT NULL DEFAULT 0,
  FOREIGN KEY ("raceId",category) REFERENCES public.cx_race_categories("raceId",category) ON DELETE CASCADE
);

CREATE TABLE public.cx_startlist_riders (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "raceId" text NOT NULL,
  category text NOT NULL,
  bib text,
  "firstName" text NOT NULL,
  "lastName" text NOT NULL,
  "countryCode" text CHECK ("countryCode" ~ '^[A-Z]{2}$'),
  "globalRiderId" text, -- resolución por género implícito; sin FK a carretera
  "teamId" text REFERENCES public.cx_teams(id) ON DELETE SET NULL,
  "sortOrder" int NOT NULL DEFAULT 0,
  FOREIGN KEY ("raceId",category) REFERENCES public.cx_race_categories("raceId",category) ON DELETE CASCADE
);

CREATE TABLE public.cx_race_uci_links (
  "raceId" text PRIMARY KEY REFERENCES public.cx_races(id) ON DELETE CASCADE,
  "competitionId" int NOT NULL UNIQUE CHECK ("competitionId" > 0),
  "disciplineId" int NOT NULL DEFAULT 3 CHECK ("disciplineId" = 3),
  "seasonId" int,
  "uciRaceId" int NOT NULL DEFAULT 0 CHECK ("uciRaceId" >= 0),
  "syncStatus" text NOT NULL DEFAULT 'pending' CHECK ("syncStatus" IN ('pending','ok','error','partial')),
  "syncEnabled" boolean NOT NULL DEFAULT false,
  "syncStartOffsetMinutes" int NOT NULL DEFAULT -15,
  "syncStopOffsetMinutes" int NOT NULL DEFAULT 720,
  "syncIntervalMinutes" int NOT NULL DEFAULT 30 CHECK ("syncIntervalMinutes" BETWEEN 1 AND 240),
  "lastFetchAt" timestamptz,
  "lastFetchError" text,
  "updatedAt" timestamptz NOT NULL DEFAULT now(),
  CHECK ("syncStartOffsetMinutes" BETWEEN -1440 AND 1440
    AND "syncStopOffsetMinutes" BETWEEN -1440 AND 2880
    AND "syncStopOffsetMinutes" >= "syncStartOffsetMinutes")
);

CREATE TABLE public.cx_results (
  id bigserial PRIMARY KEY,
  "raceId" text NOT NULL,
  category text NOT NULL,
  rank int CHECK (rank > 0),
  "rankText" text,
  bib text,
  "riderDisplay" text NOT NULL,
  "firstName" text,
  "lastName" text,
  "globalRiderId" text,
  "teamName" text,
  "isoCode2" text CHECK ("isoCode2" ~ '^[A-Z]{2}$'),
  "timeText" text,
  "gapText" text,
  points numeric,
  "bonusPoints" numeric DEFAULT 0, -- ajustes en puntos; sanciones negativas admitidas
  "timeSeconds" bigint CHECK ("timeSeconds" >= 0), -- tiempo real de meta sin bonos
  "bonusSeconds" int CHECK ("bonusSeconds" >= 0), -- NULL por defecto: desconocido; 0 explícito: confirmado
  irm text,
  "sortOrder" int NOT NULL DEFAULT 0,
  FOREIGN KEY ("raceId",category) REFERENCES public.cx_race_categories("raceId",category) ON DELETE CASCADE,
  UNIQUE ("raceId",category,"sortOrder")
);

CREATE TABLE public.cx_tournament_standings (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "tournamentId" text NOT NULL,
  "seasonKey" text NOT NULL,
  category text NOT NULL CHECK (category IN ('ME','WE','MU','WU','MJ','WJ')),
  rank int NOT NULL CHECK (rank > 0),
  points numeric,
  "timeSeconds" bigint CHECK ("timeSeconds" >= 0),
  "globalRiderId" text,
  "riderDisplay" text NOT NULL,
  "teamName" text,
  "isoCode2" text CHECK ("isoCode2" ~ '^[A-Z]{2}$'),
  source text NOT NULL DEFAULT 'computed' CHECK (source IN ('computed','dataride','manual')),
  "updatedAt" timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY ("tournamentId","seasonKey") REFERENCES public.cx_tournaments(id,"seasonKey") ON DELETE CASCADE,
  CHECK (num_nonnulls(points,"timeSeconds") = 1) -- una sola unidad por general
);

CREATE INDEX cx_races_month_idx ON public.cx_races("seasonKey","dateKey",class);
CREATE INDEX cx_races_tournament_idx ON public.cx_races("tournamentId","seasonKey");
CREATE INDEX cx_categories_window_idx ON public.cx_race_categories("startTimeUtc","resultsStatus");
CREATE INDEX cx_broadcasts_race_idx ON public.cx_broadcasts("raceId",category,"sortOrder");
CREATE INDEX cx_videos_race_idx ON public.cx_videos("raceId",category,"sortOrder");
CREATE INDEX cx_startlist_race_idx ON public.cx_startlist_riders("raceId",category,"sortOrder");
CREATE INDEX cx_startlist_team_idx ON public.cx_startlist_riders("teamId");
CREATE INDEX cx_riders_men_team_idx ON public.cx_riders_men("currentTeamId");
CREATE INDEX cx_riders_women_team_idx ON public.cx_riders_women("currentTeamId");
CREATE INDEX cx_standings_category_idx ON public.cx_tournament_standings("tournamentId","seasonKey",category,rank);
CREATE UNIQUE INDEX cx_standings_rider_idx ON public.cx_tournament_standings("tournamentId","seasonKey",category,"globalRiderId") WHERE "globalRiderId" IS NOT NULL;

-- Sin privilegios heredados. SELECT público; DML del panel solo para admin.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['cx_tournaments','cx_teams','cx_riders_men','cx_riders_women','cx_races',
    'cx_race_categories','cx_broadcasts','cx_videos','cx_startlist_riders','cx_race_uci_links',
    'cx_results','cx_tournament_standings'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC, anon, authenticated, service_role, cc_results_worker',t);
    EXECUTE format('GRANT SELECT ON TABLE public.%I TO anon, authenticated, service_role',t);
    EXECUTE format('GRANT INSERT, UPDATE, DELETE ON TABLE public.%I TO authenticated',t);
    EXECUTE format('CREATE POLICY cx_public_read ON public.%I FOR SELECT TO anon, authenticated USING (true)',t);
    EXECUTE format('CREATE POLICY cx_admin_insert ON public.%I FOR INSERT TO authenticated WITH CHECK ((select private.is_admin()))',t);
    EXECUTE format('CREATE POLICY cx_admin_update ON public.%I FOR UPDATE TO authenticated USING ((select private.is_admin())) WITH CHECK ((select private.is_admin()))',t);
    EXECUTE format('CREATE POLICY cx_admin_delete ON public.%I FOR DELETE TO authenticated USING ((select private.is_admin()))',t);
    EXECUTE format('GRANT SELECT ON TABLE public.%I TO cc_results_worker',t);
    EXECUTE format('CREATE POLICY cx_worker_read ON public.%I FOR SELECT TO cc_results_worker USING (true)',t);
  END LOOP;
END $$;

-- Worker de resultados: reemplazo de filas y estado; no modifica agenda/torneos.
GRANT INSERT, UPDATE, DELETE ON TABLE public.cx_results, public.cx_tournament_standings TO cc_results_worker;
GRANT UPDATE ("resultsStatus","resultsImportedAt","winnerName") ON TABLE public.cx_race_categories TO cc_results_worker;
GRANT UPDATE ("syncStatus","lastFetchAt","lastFetchError","updatedAt") ON TABLE public.cx_race_uci_links TO cc_results_worker;
CREATE POLICY cx_worker_insert ON public.cx_results FOR INSERT TO cc_results_worker WITH CHECK (true);
CREATE POLICY cx_worker_update ON public.cx_results FOR UPDATE TO cc_results_worker USING (true) WITH CHECK (true);
CREATE POLICY cx_worker_delete ON public.cx_results FOR DELETE TO cc_results_worker USING (true);
CREATE POLICY cx_worker_insert ON public.cx_tournament_standings FOR INSERT TO cc_results_worker WITH CHECK (true);
CREATE POLICY cx_worker_update ON public.cx_tournament_standings FOR UPDATE TO cc_results_worker USING (true) WITH CHECK (true);
CREATE POLICY cx_worker_delete ON public.cx_tournament_standings FOR DELETE TO cc_results_worker USING (true);
CREATE POLICY cx_worker_update ON public.cx_race_categories FOR UPDATE TO cc_results_worker USING (true) WITH CHECK (true);
CREATE POLICY cx_worker_update ON public.cx_race_uci_links FOR UPDATE TO cc_results_worker USING (true) WITH CHECK (true);

REVOKE ALL ON SEQUENCE public.cx_results_id_seq FROM PUBLIC, anon, authenticated, service_role, cc_results_worker;
GRANT USAGE ON SEQUENCE public.cx_results_id_seq TO authenticated, cc_results_worker;

COMMENT ON COLUMN public.cx_results."bonusSeconds" IS 'Bonificaciones X2O en segundos a restar; agregado sprint y vuelta rápida; NULL si no verificado.';
COMMENT ON COLUMN public.cx_results."bonusPoints" IS 'Ajustes de torneo en puntos, separados de PointPcR UCI; X2O no usa esta columna.';
COMMENT ON COLUMN public.cx_results."timeSeconds" IS 'Tiempo real de meta en segundos enteros, sin bonificaciones ni forfait; conservar timeText original.';
COMMENT ON COLUMN public.cx_tournaments."pointsScheme" IS 'Referencia versionada por categoría, mode points o time; docs/cc-cx-points-schemes.json. Sin cálculo activo en F1.';

NOTIFY pgrst, 'reload schema';
