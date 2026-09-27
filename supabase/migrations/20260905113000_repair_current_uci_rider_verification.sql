-- Cierra la verificación de corredores de las plantillas UCI 2026:
-- corrige campos biográficos contra la ficha oficial, fusiona identidades
-- duplicadas, elimina una ficha de staff y repara equipos/resultados enlazados
-- a fichas incorrectas. El estado previo queda en private para reversión dirigida.
BEGIN;

CREATE TABLE private.uci_rider_verification_backup_20260905 (
  section text PRIMARY KEY,
  payload jsonb NOT NULL,
  backed_up_at timestamptz NOT NULL DEFAULT now()
);

REVOKE ALL ON TABLE private.uci_rider_verification_backup_20260905
  FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON TABLE private.uci_rider_verification_backup_20260905 IS
  'Estado previo a las correcciones biográficas, fusiones y reparaciones de fichas UCI aplicadas el 05/09/2026.';

DO $$
DECLARE
  v_nationalities integer;
  v_birth_dates integer;
  v_cleanup_sources integer;
  v_cleanup_targets integer;
  v_club_links integer;
  v_coappearances integer;
  v_staff_results integer;
BEGIN
  WITH expected(id, old_value, new_value) AS (VALUES
    ('almutaiwei-mohammad', 'sa', 'ae'),
    ('andre-andrey', 'pt', 'br'),
    ('balazs-mate', 'hu', 'de'),
    ('beadle-hamish', 'au', 'nz'),
    ('bereznyak-aleksandr', 'kz', 'ru'),
    ('boardman-samuel', 'gb', 'us'),
    ('bonini-fanny', 'fr', 'it'),
    ('breser-pol', 'fr', 'lu'),
    ('brits-hannu', 'fi', 'be'),
    ('brits-noah', 'za', 'be'),
    ('crockett-finn', 'gb', 'ie'),
    ('crozzolo-fabrizio', 'it', 'ar'),
    ('davids-brendon', 'za', 'au'),
    ('de-boer-manon', 'be', 'nl'),
    ('de-vallier-elisa', 'si', 'it'),
    ('giuliano-dario', 'it', 'fr'),
    ('huot-mathilde', 'fr', 'ca'),
    ('irvine-declan', 'gb', 'au'),
    ('janssen-christoph', 'de', 'ch'),
    ('jones-helena', 'gb', 'us'),
    ('jordan-ayden', 'us', 'at'),
    ('kingston-matthew', 'au', 'gb'),
    ('knaven-senne', 'nl', 'be'),
    ('laurijssen-sanne', 'nl', 'be'),
    ('meo-felix-james', 'au', 'nz'),
    ('merlov-ville', 'dk', 'se'),
    ('mishankov-maksim', 'by', 'ru'),
    ('mwamikazi-jazilla', 'tz', 'rw'),
    ('o-brien-finn', 'ie', 'gb'),
    ('raus-jerome', 'fr', 'be'),
    ('rolando-joann', 'fr', 'it'),
    ('rosenlund-stian', 'no', 'dk'),
    ('savioz-colin', 'ch', 'fr'),
    ('silva-joao', 'br', 'pt'),
    ('sivok-tomas', 'cz', 'sk'),
    ('stepanov-andrei', 'kz', 'ru'),
    ('torkachenko-pavel', 'ua', 'ru'),
    ('wafler-tim', 'de', 'at'),
    ('wasserbaech-madeleine', 'de', 'au'),
    ('whitehouse-daniel', 'gb', 'nz'),
    ('anisimov-ivan', NULL, 'ru')
  ), riders AS (
    SELECT id, nationality, verified, "uciProfileId" FROM public.riders_men
    UNION ALL
    SELECT id, nationality, verified, "uciProfileId" FROM public.riders_women
  )
  SELECT count(*) INTO v_nationalities
  FROM expected e
  JOIN riders r ON r.id = e.id
    AND r.nationality IS NOT DISTINCT FROM e.old_value
    AND r.verified
    AND (e.id = 'anisimov-ivan' OR r."uciProfileId" IS NOT NULL);

  WITH expected(id, old_value, new_value) AS (VALUES
    ('cambareri-bernardo-gaston', date '2001-05-09', date '2005-05-09'),
    ('cipollini-edoardo', date '1996-06-24', date '2005-04-27'),
    ('martinez-dani', date '1996-02-05', date '1996-04-25'),
    ('phounsavath-ariya', date '1991-03-02', date '1991-02-03'),
    ('romeo-abad-sergio-2', date '2005-02-04', date '2005-02-05'),
    ('servranckx-gauthier', date '2005-07-06', date '2005-07-07'),
    ('soto-guirao-antonio-jesus', date '1994-12-23', date '1994-12-24'),
    ('walton-jonas', date '2004-03-06', date '2004-03-08')
  ), riders AS (
    SELECT id, "birthDate", verified, "uciProfileId" FROM public.riders_men
    UNION ALL
    SELECT id, "birthDate", verified, "uciProfileId" FROM public.riders_women
  )
  SELECT count(*) INTO v_birth_dates
  FROM expected e
  JOIN riders r ON r.id = e.id
    AND r."birthDate" = e.old_value
    AND r.verified
    AND r."uciProfileId" IS NOT NULL;

  SELECT count(*) INTO v_cleanup_sources
  FROM public.riders_women
  WHERE id IN ('clay-lene-robyn', 'quagliotto-giulia', 'docx-katja', 'scandolara-valentina')
    AND NOT verified AND "uciProfileId" IS NULL;

  SELECT count(*) INTO v_cleanup_targets
  FROM public.riders_women
  WHERE (id = 'clay-robyn' AND "uciProfileId" = '1150413'
      AND "birthDate" = date '2003-10-13' AND nationality = 'gb' AND verified)
     OR (id = 'quagliotto-nadia' AND "uciProfileId" = '106787'
      AND "birthDate" = date '1997-03-22' AND nationality = 'it' AND verified)
     OR (id = 'docx-mieke' AND "uciProfileId" = '98619'
      AND "birthDate" = date '1996-06-08' AND nationality = 'be' AND verified)
     OR (id = 'de-marigny-lagesse-lucie' AND "uciProfileId" = '1193233' AND verified)
     OR (id = 'mwamikazi-jazilla' AND "uciProfileId" = '1072682' AND verified);

  SELECT count(*) INTO v_club_links
  FROM public.rider_team_affiliations
  WHERE "riderGender" = 'male' AND year = 2026
    AND "affiliationType" = 'regular' AND "dateFrom" IS NULL AND "dateTo" IS NULL
    AND "teamId" = 'team_1776715672148_9njdjy'
    AND "riderId" IN ('brissaire-alix', 'foucoin-owen', 'rullier-hans', 'thierry-paul');

  SELECT count(*) INTO v_coappearances
  FROM (VALUES
    ('clay-lene-robyn', 'clay-robyn'),
    ('quagliotto-giulia', 'quagliotto-nadia'),
    ('docx-katja', 'docx-mieke')
  ) p(source_id, target_id)
  WHERE EXISTS (
    SELECT 1 FROM public.startlist_riders a
    JOIN public.startlist_riders b ON b."raceId" = a."raceId"
    WHERE a."globalRiderId" = p.source_id AND b."globalRiderId" = p.target_id
  ) OR EXISTS (
    SELECT 1 FROM public.race_uci_results a
    JOIN public.race_uci_results b ON b."stageRef" = a."stageRef"
    WHERE a."globalRiderId" = p.source_id AND b."globalRiderId" = p.target_id
  );

  SELECT count(*) INTO v_staff_results
  FROM public.race_uci_results
  WHERE ("stageRef" = 'ru_366675' AND "globalRiderId" = 'scandolara-valentina'
      AND upper(COALESCE("riderDisplay", '')) LIKE 'DE MARIGNY%')
     OR ("stageRef" = 'ru_375843' AND "globalRiderId" = 'scandolara-valentina'
      AND upper(COALESCE("riderDisplay", '')) LIKE 'MWAMIKAZI%')
     OR ("stageRef" = 'ru_375843' AND "globalRiderId" = 'mwamikazi-jazilla'
      AND upper(COALESCE("riderDisplay", '')) LIKE 'DE MARIGNY%');

  IF v_nationalities <> 41 OR v_birth_dates <> 8
    OR v_cleanup_sources <> 4 OR v_cleanup_targets <> 5
    OR v_club_links <> 4 OR v_coappearances <> 0 OR v_staff_results <> 3
  THEN
    RAISE EXCEPTION
      'uci_rider_verification_precondition_changed: nationalities %, births %, sources %, targets %, club_links %, coappearances %, staff_results %',
      v_nationalities, v_birth_dates, v_cleanup_sources, v_cleanup_targets,
      v_club_links, v_coappearances, v_staff_results;
  END IF;

  IF (SELECT count(*) FROM public.startlist_riders
      WHERE "globalRiderId" = 'clay-lene-robyn') <> 3
    OR (SELECT count(*) FROM public.race_uci_results
      WHERE "globalRiderId" = 'clay-lene-robyn') <> 2
    OR (SELECT count(*) FROM public.startlist_riders
      WHERE "globalRiderId" = 'quagliotto-giulia') <> 1
    OR (SELECT count(*) FROM public.race_uci_results
      WHERE "globalRiderId" = 'quagliotto-giulia') <> 1
    OR (SELECT count(*) FROM public.startlist_riders
      WHERE "globalRiderId" = 'docx-katja') <> 1
    OR EXISTS (SELECT 1 FROM public.race_uci_results
      WHERE "globalRiderId" = 'docx-katja')
    OR (SELECT count(*) FROM public.startlist_riders
      WHERE "globalRiderId" = 'scandolara-valentina') <> 2
    OR (SELECT count(*) FROM public.race_uci_results
      WHERE "globalRiderId" = 'scandolara-valentina') <> 2
    OR EXISTS (SELECT 1 FROM public.rider_transfers
      WHERE "riderGender" = 'female' AND "riderId" IN
        ('clay-lene-robyn', 'quagliotto-giulia', 'docx-katja', 'scandolara-valentina'))
  THEN
    RAISE EXCEPTION 'uci_rider_verification_reference_precondition_changed';
  END IF;
END;
$$;

WITH affected(id) AS (VALUES
  ('almutaiwei-mohammad'), ('andre-andrey'), ('balazs-mate'), ('beadle-hamish'),
  ('bereznyak-aleksandr'), ('boardman-samuel'), ('bonini-fanny'), ('breser-pol'),
  ('brits-hannu'), ('brits-noah'), ('crockett-finn'), ('crozzolo-fabrizio'),
  ('davids-brendon'), ('de-boer-manon'), ('de-vallier-elisa'), ('giuliano-dario'),
  ('huot-mathilde'), ('irvine-declan'), ('janssen-christoph'), ('jones-helena'),
  ('jordan-ayden'), ('kingston-matthew'), ('knaven-senne'), ('laurijssen-sanne'),
  ('meo-felix-james'), ('merlov-ville'), ('mishankov-maksim'), ('mwamikazi-jazilla'),
  ('o-brien-finn'), ('raus-jerome'), ('rolando-joann'), ('rosenlund-stian'),
  ('savioz-colin'), ('silva-joao'), ('sivok-tomas'), ('stepanov-andrei'),
  ('torkachenko-pavel'), ('wafler-tim'), ('wasserbaech-madeleine'),
  ('whitehouse-daniel'), ('anisimov-ivan'), ('cambareri-bernardo-gaston'),
  ('cipollini-edoardo'), ('martinez-dani'), ('phounsavath-ariya'),
  ('romeo-abad-sergio-2'), ('servranckx-gauthier'),
  ('soto-guirao-antonio-jesus'), ('walton-jonas'), ('baldi-p'),
  ('brissaire-alix'), ('clay-lene-robyn'), ('clay-robyn'), ('docx-katja'),
  ('docx-mieke'), ('foucoin-owen'), ('milesi-silvia'), ('quagliotto-giulia'),
  ('quagliotto-nadia'), ('rullier-hans'), ('scandolara-valentina'),
  ('thierry-paul'), ('de-marigny-lagesse-lucie')
)
INSERT INTO private.uci_rider_verification_backup_20260905(section, payload)
SELECT 'riders_men', COALESCE(jsonb_agg(to_jsonb(r) ORDER BY r.id), '[]'::jsonb)
FROM public.riders_men r JOIN affected a ON a.id = r.id
UNION ALL
SELECT 'riders_women', COALESCE(jsonb_agg(to_jsonb(r) ORDER BY r.id), '[]'::jsonb)
FROM public.riders_women r JOIN affected a ON a.id = r.id;

WITH affected(id) AS (VALUES
  ('almutaiwei-mohammad'), ('andre-andrey'), ('balazs-mate'), ('beadle-hamish'),
  ('bereznyak-aleksandr'), ('boardman-samuel'), ('bonini-fanny'), ('breser-pol'),
  ('brits-hannu'), ('brits-noah'), ('crockett-finn'), ('crozzolo-fabrizio'),
  ('davids-brendon'), ('de-boer-manon'), ('de-vallier-elisa'), ('giuliano-dario'),
  ('huot-mathilde'), ('irvine-declan'), ('janssen-christoph'), ('jones-helena'),
  ('jordan-ayden'), ('kingston-matthew'), ('knaven-senne'), ('laurijssen-sanne'),
  ('meo-felix-james'), ('merlov-ville'), ('mishankov-maksim'), ('mwamikazi-jazilla'),
  ('o-brien-finn'), ('raus-jerome'), ('rolando-joann'), ('rosenlund-stian'),
  ('savioz-colin'), ('silva-joao'), ('sivok-tomas'), ('stepanov-andrei'),
  ('torkachenko-pavel'), ('wafler-tim'), ('wasserbaech-madeleine'),
  ('whitehouse-daniel'), ('anisimov-ivan'), ('clay-lene-robyn'),
  ('quagliotto-giulia'), ('docx-katja'), ('scandolara-valentina')
)
INSERT INTO private.uci_rider_verification_backup_20260905(section, payload)
SELECT 'startlist_riders', COALESCE(jsonb_agg(to_jsonb(s) ORDER BY s.id), '[]'::jsonb)
FROM public.startlist_riders s JOIN affected a ON a.id = s."globalRiderId";

WITH affected(id) AS (VALUES
  ('baldi-p'), ('brissaire-alix'), ('clay-lene-robyn'), ('clay-robyn'),
  ('docx-katja'), ('docx-mieke'), ('foucoin-owen'), ('milesi-silvia'),
  ('quagliotto-giulia'), ('quagliotto-nadia'), ('rullier-hans'),
  ('scandolara-valentina'), ('thierry-paul'), ('de-marigny-lagesse-lucie'),
  ('mwamikazi-jazilla')
)
INSERT INTO private.uci_rider_verification_backup_20260905(section, payload)
SELECT 'affiliations', COALESCE(jsonb_agg(to_jsonb(a) ORDER BY a.id), '[]'::jsonb)
FROM public.rider_team_affiliations a JOIN affected x ON x.id = a."riderId"
UNION ALL
SELECT 'results', COALESCE(jsonb_agg(to_jsonb(r) ORDER BY r."stageRef", r.id), '[]'::jsonb)
FROM public.race_uci_results r JOIN affected x ON x.id = r."globalRiderId"
UNION ALL
SELECT 'aliases', COALESCE(jsonb_agg(to_jsonb(a) ORDER BY a.gender, a."aliasKey"), '[]'::jsonb)
FROM public.rider_identity_aliases a JOIN affected x ON x.id = a."riderId";

INSERT INTO private.uci_rider_verification_backup_20260905(section, payload)
SELECT 'catalog_cases', COALESCE(jsonb_agg(to_jsonb(c) ORDER BY c.key), '[]'::jsonb)
FROM private.uci_catalog_cases c
WHERE c.key IN ('rider:2026:1610729', 'rider:2026:482927');

WITH values_to_apply(id, old_value, new_value) AS (VALUES
  ('almutaiwei-mohammad', 'sa', 'ae'),
  ('andre-andrey', 'pt', 'br'),
  ('balazs-mate', 'hu', 'de'),
  ('beadle-hamish', 'au', 'nz'),
  ('bereznyak-aleksandr', 'kz', 'ru'),
  ('boardman-samuel', 'gb', 'us'),
  ('bonini-fanny', 'fr', 'it'),
  ('breser-pol', 'fr', 'lu'),
  ('brits-hannu', 'fi', 'be'),
  ('brits-noah', 'za', 'be'),
  ('crockett-finn', 'gb', 'ie'),
  ('crozzolo-fabrizio', 'it', 'ar'),
  ('davids-brendon', 'za', 'au'),
  ('de-boer-manon', 'be', 'nl'),
  ('de-vallier-elisa', 'si', 'it'),
  ('giuliano-dario', 'it', 'fr'),
  ('huot-mathilde', 'fr', 'ca'),
  ('irvine-declan', 'gb', 'au'),
  ('janssen-christoph', 'de', 'ch'),
  ('jones-helena', 'gb', 'us'),
  ('jordan-ayden', 'us', 'at'),
  ('kingston-matthew', 'au', 'gb'),
  ('knaven-senne', 'nl', 'be'),
  ('laurijssen-sanne', 'nl', 'be'),
  ('meo-felix-james', 'au', 'nz'),
  ('merlov-ville', 'dk', 'se'),
  ('mishankov-maksim', 'by', 'ru'),
  ('mwamikazi-jazilla', 'tz', 'rw'),
  ('o-brien-finn', 'ie', 'gb'),
  ('raus-jerome', 'fr', 'be'),
  ('rolando-joann', 'fr', 'it'),
  ('rosenlund-stian', 'no', 'dk'),
  ('savioz-colin', 'ch', 'fr'),
  ('silva-joao', 'br', 'pt'),
  ('sivok-tomas', 'cz', 'sk'),
  ('stepanov-andrei', 'kz', 'ru'),
  ('torkachenko-pavel', 'ua', 'ru'),
  ('wafler-tim', 'de', 'at'),
  ('wasserbaech-madeleine', 'de', 'au'),
  ('whitehouse-daniel', 'gb', 'nz'),
  ('anisimov-ivan', NULL, 'ru')
)
UPDATE public.riders_men r
SET nationality = v.new_value, "updatedAt" = now()
FROM values_to_apply v
WHERE r.id = v.id AND r.nationality IS NOT DISTINCT FROM v.old_value;

WITH values_to_apply(id, old_value, new_value) AS (VALUES
  ('almutaiwei-mohammad', 'sa', 'ae'), ('andre-andrey', 'pt', 'br'),
  ('balazs-mate', 'hu', 'de'), ('beadle-hamish', 'au', 'nz'),
  ('bereznyak-aleksandr', 'kz', 'ru'), ('boardman-samuel', 'gb', 'us'),
  ('bonini-fanny', 'fr', 'it'), ('breser-pol', 'fr', 'lu'),
  ('brits-hannu', 'fi', 'be'), ('brits-noah', 'za', 'be'),
  ('crockett-finn', 'gb', 'ie'), ('crozzolo-fabrizio', 'it', 'ar'),
  ('davids-brendon', 'za', 'au'), ('de-boer-manon', 'be', 'nl'),
  ('de-vallier-elisa', 'si', 'it'), ('giuliano-dario', 'it', 'fr'),
  ('huot-mathilde', 'fr', 'ca'), ('irvine-declan', 'gb', 'au'),
  ('janssen-christoph', 'de', 'ch'), ('jones-helena', 'gb', 'us'),
  ('jordan-ayden', 'us', 'at'), ('kingston-matthew', 'au', 'gb'),
  ('knaven-senne', 'nl', 'be'), ('laurijssen-sanne', 'nl', 'be'),
  ('meo-felix-james', 'au', 'nz'), ('merlov-ville', 'dk', 'se'),
  ('mishankov-maksim', 'by', 'ru'), ('mwamikazi-jazilla', 'tz', 'rw'),
  ('o-brien-finn', 'ie', 'gb'), ('raus-jerome', 'fr', 'be'),
  ('rolando-joann', 'fr', 'it'), ('rosenlund-stian', 'no', 'dk'),
  ('savioz-colin', 'ch', 'fr'), ('silva-joao', 'br', 'pt'),
  ('sivok-tomas', 'cz', 'sk'), ('stepanov-andrei', 'kz', 'ru'),
  ('torkachenko-pavel', 'ua', 'ru'), ('wafler-tim', 'de', 'at'),
  ('wasserbaech-madeleine', 'de', 'au'), ('whitehouse-daniel', 'gb', 'nz'),
  ('anisimov-ivan', NULL, 'ru')
)
UPDATE public.riders_women r
SET nationality = v.new_value, "updatedAt" = now()
FROM values_to_apply v
WHERE r.id = v.id AND r.nationality IS NOT DISTINCT FROM v.old_value;

WITH values_to_apply(id, new_value) AS (VALUES
  ('almutaiwei-mohammad', 'ae'), ('andre-andrey', 'br'),
  ('balazs-mate', 'de'), ('beadle-hamish', 'nz'),
  ('bereznyak-aleksandr', 'ru'), ('boardman-samuel', 'us'),
  ('bonini-fanny', 'it'), ('breser-pol', 'lu'), ('brits-hannu', 'be'),
  ('brits-noah', 'be'), ('crockett-finn', 'ie'), ('crozzolo-fabrizio', 'ar'),
  ('davids-brendon', 'au'), ('de-boer-manon', 'nl'),
  ('de-vallier-elisa', 'it'), ('giuliano-dario', 'fr'),
  ('huot-mathilde', 'ca'), ('irvine-declan', 'au'),
  ('janssen-christoph', 'ch'), ('jones-helena', 'us'),
  ('jordan-ayden', 'at'), ('kingston-matthew', 'gb'),
  ('knaven-senne', 'be'), ('laurijssen-sanne', 'be'),
  ('meo-felix-james', 'nz'), ('merlov-ville', 'se'),
  ('mishankov-maksim', 'ru'), ('mwamikazi-jazilla', 'rw'),
  ('o-brien-finn', 'gb'), ('raus-jerome', 'be'), ('rolando-joann', 'it'),
  ('rosenlund-stian', 'dk'), ('savioz-colin', 'fr'), ('silva-joao', 'pt'),
  ('sivok-tomas', 'sk'), ('stepanov-andrei', 'ru'),
  ('torkachenko-pavel', 'ru'), ('wafler-tim', 'at'),
  ('wasserbaech-madeleine', 'au'), ('whitehouse-daniel', 'nz'),
  ('anisimov-ivan', 'ru')
)
UPDATE public.startlist_riders row
SET "countryCode" = v.new_value
FROM values_to_apply v
WHERE row."globalRiderId" = v.id
  AND row."countryCode" IS DISTINCT FROM v.new_value;

WITH values_to_apply(id, old_value, new_value) AS (VALUES
  ('cambareri-bernardo-gaston', date '2001-05-09', date '2005-05-09'),
  ('cipollini-edoardo', date '1996-06-24', date '2005-04-27'),
  ('martinez-dani', date '1996-02-05', date '1996-04-25'),
  ('phounsavath-ariya', date '1991-03-02', date '1991-02-03'),
  ('romeo-abad-sergio-2', date '2005-02-04', date '2005-02-05'),
  ('servranckx-gauthier', date '2005-07-06', date '2005-07-07'),
  ('soto-guirao-antonio-jesus', date '1994-12-23', date '1994-12-24'),
  ('walton-jonas', date '2004-03-06', date '2004-03-08')
)
UPDATE public.riders_men r
SET "birthDate" = v.new_value, "updatedAt" = now()
FROM values_to_apply v
WHERE r.id = v.id AND r."birthDate" = v.old_value;

WITH values_to_apply(id, old_value, new_value) AS (VALUES
  ('cambareri-bernardo-gaston', date '2001-05-09', date '2005-05-09'),
  ('cipollini-edoardo', date '1996-06-24', date '2005-04-27'),
  ('martinez-dani', date '1996-02-05', date '1996-04-25'),
  ('phounsavath-ariya', date '1991-03-02', date '1991-02-03'),
  ('romeo-abad-sergio-2', date '2005-02-04', date '2005-02-05'),
  ('servranckx-gauthier', date '2005-07-06', date '2005-07-07'),
  ('soto-guirao-antonio-jesus', date '1994-12-23', date '1994-12-24'),
  ('walton-jonas', date '2004-03-06', date '2004-03-08')
)
UPDATE public.riders_women r
SET "birthDate" = v.new_value, "updatedAt" = now()
FROM values_to_apply v
WHERE r.id = v.id AND r."birthDate" = v.old_value;

UPDATE public.riders_men
SET "lastName" = 'Anisimov', "updatedAt" = now()
WHERE id = 'anisimov-ivan' AND "lastName" = 'Anisimov***';

UPDATE public.startlist_riders
SET "lastName" = 'Anisimov'
WHERE "globalRiderId" = 'anisimov-ivan' AND "lastName" = 'Anisimov***';

-- Los cuatro corredores son hombres de Mayenne-Monbana-Rapido (club), no
-- integrantes de la estructura femenina UCI que compartía el nombre Mayenne.
UPDATE public.rider_team_affiliations a
SET id = a."riderId" || '__team_auto_1e2587adc449eb177263deff22498dfe__2026',
    "teamId" = 'team_auto_1e2587adc449eb177263deff22498dfe',
    source = 'startlist_club', verified = true,
    "dateBasis" = 'season_roster', "verifiedAt" = now(), "updatedAt" = now()
WHERE a."riderGender" = 'male' AND a.year = 2026
  AND a."affiliationType" = 'regular' AND a."dateFrom" IS NULL AND a."dateTo" IS NULL
  AND a."teamId" = 'team_1776715672148_9njdjy'
  AND a."riderId" IN ('brissaire-alix', 'foucoin-owen', 'rullier-hans', 'thierry-paul');

-- Dos fichas reales dejan de figurar como integrantes actuales de equipos UCI.
UPDATE public.rider_team_affiliations
SET "dateTo" = date '2026-05-21', "dateBasis" = 'season_roster',
    source = 'manual_review', "updatedAt" = now()
WHERE "riderId" = 'baldi-p' AND "riderGender" = 'female' AND year = 2026
  AND "affiliationType" = 'regular' AND "dateTo" IS NULL;

UPDATE public.rider_team_affiliations
SET "dateTo" = date '2026-09-04', "dateBasis" = 'season_roster',
    source = 'manual_review',
    "sourceUrl" = 'https://www.uci.org/team-details/21333', "updatedAt" = now()
WHERE "riderId" = 'milesi-silvia' AND "riderGender" = 'female' AND year = 2026
  AND "affiliationType" = 'regular' AND "dateTo" IS NULL;

WITH pairs(source_id, target_id) AS (VALUES
  ('clay-lene-robyn', 'clay-robyn'),
  ('quagliotto-giulia', 'quagliotto-nadia'),
  ('docx-katja', 'docx-mieke')
)
UPDATE public.startlist_riders row SET
  "globalRiderId" = p.target_id,
  "firstName" = target."firstName",
  "lastName" = target."lastName",
  "countryCode" = target.nationality
FROM pairs p
JOIN public.riders_women target ON target.id = p.target_id
WHERE row."globalRiderId" = p.source_id;

WITH pairs(source_id, target_id) AS (VALUES
  ('clay-lene-robyn', 'clay-robyn'),
  ('quagliotto-giulia', 'quagliotto-nadia')
)
UPDATE public.race_uci_results row
SET "globalRiderId" = p.target_id
FROM pairs p
WHERE row."globalRiderId" = p.source_id;

DELETE FROM public.rider_team_affiliations
WHERE "riderGender" = 'female'
  AND "riderId" IN ('clay-lene-robyn', 'quagliotto-giulia', 'docx-katja');

INSERT INTO public.rider_identity_aliases("aliasKey", gender, "riderId", note)
VALUES
  ('clay-lene-robyn', 'female', 'clay-robyn',
    'Fusión verificada contra perfil y plantilla UCI 2026 el 05/09/2026'),
  ('giulia-quagliotto', 'female', 'quagliotto-nadia',
    'Corrección de identidad de una importación de resultados el 05/09/2026'),
  ('docx-katja', 'female', 'docx-mieke',
    'Corrección de nombre compuesto en una importación de inscritos el 05/09/2026')
ON CONFLICT ("aliasKey", gender) DO UPDATE SET
  "riderId" = EXCLUDED."riderId", note = EXCLUDED.note;

UPDATE public.riders_women
SET "otherNames" = CASE
      WHEN COALESCE("otherNames", '') ILIKE '%Lene Robyn Clay%' THEN "otherNames"
      ELSE concat_ws(', ', NULLIF("otherNames", ''), 'Lene Robyn Clay')
    END,
    "updatedAt" = now()
WHERE id = 'clay-robyn';

DELETE FROM public.riders_women
WHERE id IN ('clay-lene-robyn', 'quagliotto-giulia', 'docx-katja');

-- Valentina Scandolara es personal técnico del WCC Team. Dos resultados que
-- apuntaban a su ficha pertenecen a corredoras del equipo y una tercera fila
-- estaba cruzada entre esas mismas corredoras.
UPDATE public.race_uci_results
SET "globalRiderId" = 'de-marigny-lagesse-lucie'
WHERE "stageRef" = 'ru_366675' AND "globalRiderId" = 'scandolara-valentina'
  AND upper(COALESCE("riderDisplay", '')) LIKE 'DE MARIGNY%';

UPDATE public.race_uci_results
SET "globalRiderId" = 'mwamikazi-jazilla'
WHERE "stageRef" = 'ru_375843' AND "globalRiderId" = 'scandolara-valentina'
  AND upper(COALESCE("riderDisplay", '')) LIKE 'MWAMIKAZI%';

UPDATE public.race_uci_results
SET "globalRiderId" = 'de-marigny-lagesse-lucie'
WHERE "stageRef" = 'ru_375843' AND "globalRiderId" = 'mwamikazi-jazilla'
  AND upper(COALESCE("riderDisplay", '')) LIKE 'DE MARIGNY%';

DELETE FROM public.startlist_riders
WHERE "globalRiderId" = 'scandolara-valentina';

DELETE FROM public.rider_team_affiliations
WHERE "riderId" = 'scandolara-valentina' AND "riderGender" = 'female';

DELETE FROM public.riders_women
WHERE id = 'scandolara-valentina';

SELECT public.recompute_current_team(rider_id, gender)
FROM (VALUES
  ('baldi-p', 'female'), ('milesi-silvia', 'female'),
  ('brissaire-alix', 'male'), ('foucoin-owen', 'male'),
  ('rullier-hans', 'male'), ('thierry-paul', 'male')
) x(rider_id, gender);

SELECT private.uci_catalog_review_case(
  'rider:2026:482927', 'resolved',
  'Se conserva 2002-08-20 para Tobias Lund Andresen: la ficha UCI devuelve 2002-02-08 con sourceConflict=true y contradice las fuentes biográficas concordantes. No se aplica el valor anómalo.'
);

DO $$
DECLARE
  v_fields integer;
BEGIN
  WITH expected(id, nationality) AS (VALUES
    ('almutaiwei-mohammad', 'ae'), ('andre-andrey', 'br'), ('balazs-mate', 'de'),
    ('beadle-hamish', 'nz'), ('bereznyak-aleksandr', 'ru'),
    ('boardman-samuel', 'us'), ('bonini-fanny', 'it'), ('breser-pol', 'lu'),
    ('brits-hannu', 'be'), ('brits-noah', 'be'), ('crockett-finn', 'ie'),
    ('crozzolo-fabrizio', 'ar'), ('davids-brendon', 'au'),
    ('de-boer-manon', 'nl'), ('de-vallier-elisa', 'it'),
    ('giuliano-dario', 'fr'), ('huot-mathilde', 'ca'), ('irvine-declan', 'au'),
    ('janssen-christoph', 'ch'), ('jones-helena', 'us'), ('jordan-ayden', 'at'),
    ('kingston-matthew', 'gb'), ('knaven-senne', 'be'),
    ('laurijssen-sanne', 'be'), ('meo-felix-james', 'nz'),
    ('merlov-ville', 'se'), ('mishankov-maksim', 'ru'),
    ('mwamikazi-jazilla', 'rw'), ('o-brien-finn', 'gb'), ('raus-jerome', 'be'),
    ('rolando-joann', 'it'), ('rosenlund-stian', 'dk'), ('savioz-colin', 'fr'),
    ('silva-joao', 'pt'), ('sivok-tomas', 'sk'), ('stepanov-andrei', 'ru'),
    ('torkachenko-pavel', 'ru'), ('wafler-tim', 'at'),
    ('wasserbaech-madeleine', 'au'), ('whitehouse-daniel', 'nz'),
    ('anisimov-ivan', 'ru')
  ), riders AS (
    SELECT id, nationality FROM public.riders_men
    UNION ALL SELECT id, nationality FROM public.riders_women
  )
  SELECT count(*) INTO v_fields FROM expected e JOIN riders r USING (id)
  WHERE r.nationality = e.nationality;

  IF v_fields <> 41
    OR EXISTS (SELECT 1 FROM public.riders_men
      WHERE id = 'anisimov-ivan' AND "lastName" <> 'Anisimov')
    OR EXISTS (SELECT 1 FROM public.riders_men
      WHERE id IN ('brissaire-alix', 'foucoin-owen', 'rullier-hans', 'thierry-paul')
        AND "currentTeamId" IS DISTINCT FROM 'team_auto_1e2587adc449eb177263deff22498dfe')
    OR EXISTS (SELECT 1 FROM public.riders_women
      WHERE id IN ('baldi-p', 'milesi-silvia') AND "currentTeamId" IS NOT NULL)
    OR EXISTS (SELECT 1 FROM public.riders_women
      WHERE id IN ('clay-lene-robyn', 'quagliotto-giulia', 'docx-katja', 'scandolara-valentina'))
    OR EXISTS (SELECT 1 FROM public.startlist_riders
      WHERE "globalRiderId" IN ('clay-lene-robyn', 'quagliotto-giulia', 'docx-katja', 'scandolara-valentina'))
    OR EXISTS (SELECT 1 FROM public.race_uci_results
      WHERE "globalRiderId" IN ('clay-lene-robyn', 'quagliotto-giulia', 'scandolara-valentina'))
    OR (SELECT count(*) FROM private.uci_rider_verification_backup_20260905) <> 7
    OR NOT EXISTS (SELECT 1 FROM private.uci_catalog_cases
      WHERE key = 'rider:2026:482927' AND status = 'resolved')
  THEN
    RAISE EXCEPTION 'uci_rider_verification_postcondition_failed';
  END IF;
END;
$$;

COMMIT;
