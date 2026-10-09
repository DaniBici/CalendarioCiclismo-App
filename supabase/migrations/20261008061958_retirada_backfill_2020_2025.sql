-- Retirada del backfill 2020-2025: carreras, jornadas, series, equipos,
-- temporadas, afiliaciones y fichas del catálogo histórico. Se conserva íntegra
-- la Clàssica Camp de Morvedre 2025 (con las temporadas 2025 de sus equipos y
-- las afiliaciones 2025 de sus corredores) y toda entidad del catálogo
-- histórico que siga referenciada: 12 fichas de Morvedre 2025, 18 de ciclocross
-- y Velolien Matsuyama (Oita Urban Classic 2026). Borra exactamente las filas
-- respaldadas en private.retirada_backfill_20261008_* y aborta si cambia
-- cualquier dato vigente.

CREATE TEMP VIEW retirada_metricas AS
SELECT jsonb_build_object(
  'races_2026_2027', (SELECT count(*) FROM public.races WHERE year >= 2026),
  'days_2026_2027', (SELECT count(*) FROM public.race_days d JOIN public.races r ON r.id = d."raceId" WHERE r.year >= 2026),
  'results_vigentes', (SELECT count(*) FROM public.race_uci_results x JOIN public.races r ON r.id = x."raceId" WHERE r.year >= 2026 OR r.id = '6e08f4f2-2d37-4093-9929-d1df1e82e627'),
  'points_vigentes', (SELECT coalesce(sum(x."uciPoints"), 0) FROM public.race_uci_results x JOIN public.races r ON r.id = x."raceId" WHERE r.year >= 2026 OR r.id = '6e08f4f2-2d37-4093-9929-d1df1e82e627'),
  'startlist_teams_null', (SELECT count(*) FROM public.startlist_teams WHERE "teamId" IS NULL),
  'men_current', (SELECT md5(string_agg(id || ':' || coalesce("currentTeamId", ''), ',' ORDER BY id)) FROM public.riders_men WHERE NOT "historicalCatalogOnly"),
  'women_current', (SELECT md5(string_agg(id || ':' || coalesce("currentTeamId", ''), ',' ORDER BY id)) FROM public.riders_women WHERE NOT "historicalCatalogOnly"),
  'rankings_null', (SELECT count(*) FROM public.uci_team_rankings WHERE "teamId" IS NULL),
  'tld_null', (SELECT count(*) FROM public.team_link_decisions WHERE "teamId" IS NULL),
  'parents', (SELECT md5(string_agg(id || ':' || coalesce("parentTeamId", ''), ',' ORDER BY id)) FROM public.teams
      WHERE id NOT IN (SELECT id FROM private.retirada_backfill_20261008_teams)),
  'seasons_2026_2027', (SELECT md5(string_agg(to_jsonb(s)::text, ',' ORDER BY s.id)) FROM public.team_seasons s WHERE year >= 2026),
  'affil_2026_2027', (SELECT md5(string_agg(to_jsonb(a)::text, ',' ORDER BY a.id)) FROM public.rider_team_affiliations a WHERE year >= 2026),
  'series_vigentes', (SELECT count(*) FROM public.race_series s WHERE EXISTS (SELECT 1 FROM public.races r WHERE r."raceSeriesId" = s.id AND (r.year >= 2026 OR r.id = '6e08f4f2-2d37-4093-9929-d1df1e82e627'))),
  'morvedre', (SELECT md5(concat_ws('|',
      (SELECT string_agg(to_jsonb(d)::text, ',' ORDER BY d.id) FROM public.race_days d WHERE d."raceId" = '6e08f4f2-2d37-4093-9929-d1df1e82e627'),
      (SELECT string_agg(to_jsonb(t)::text, ',' ORDER BY t.id) FROM public.startlist_teams t WHERE t."raceId" = '6e08f4f2-2d37-4093-9929-d1df1e82e627'),
      (SELECT string_agg(to_jsonb(t)::text, ',' ORDER BY t.id) FROM public.startlist_riders t WHERE t."raceId" = '6e08f4f2-2d37-4093-9929-d1df1e82e627'),
      (SELECT string_agg(to_jsonb(t)::text, ',' ORDER BY t.id) FROM public.race_uci_results t WHERE t."raceId" = '6e08f4f2-2d37-4093-9929-d1df1e82e627'),
      (SELECT string_agg(to_jsonb(s)::text, ',' ORDER BY s.id) FROM public.team_seasons s JOIN public.startlist_teams t ON t."teamId" = s."teamId" AND t."raceId" = '6e08f4f2-2d37-4093-9929-d1df1e82e627' WHERE s.year = 2025),
      (SELECT string_agg(to_jsonb(a)::text, ',' ORDER BY a.id) FROM public.rider_team_affiliations a WHERE a.year = 2025)))),
  'sl_riders_sin_ficha', (SELECT count(*) FROM public.startlist_riders s WHERE s."globalRiderId" IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM public.riders_men m WHERE m.id = s."globalRiderId")
      AND NOT EXISTS (SELECT 1 FROM public.riders_women w WHERE w.id = s."globalRiderId")),
  'results_sin_ficha', (SELECT count(*) FROM public.race_uci_results s WHERE s."globalRiderId" IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM public.riders_men m WHERE m.id = s."globalRiderId")
      AND NOT EXISTS (SELECT 1 FROM public.riders_women w WHERE w.id = s."globalRiderId")),
  'cx_sin_ficha', (SELECT count(*) FROM public.cx_results s WHERE s."globalRiderId" IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM public.riders_men m WHERE m.id = s."globalRiderId")
      AND NOT EXISTS (SELECT 1 FROM public.riders_women w WHERE w.id = s."globalRiderId")),
  'transfers_sin_ficha', (SELECT count(*) FROM public.rider_transfers s
      WHERE NOT EXISTS (SELECT 1 FROM public.riders_men m WHERE m.id = s."riderId")
        AND NOT EXISTS (SELECT 1 FROM public.riders_women w WHERE w.id = s."riderId"))
) AS m;

CREATE TEMP TABLE retirada_antes ON COMMIT DROP AS SELECT m FROM retirada_metricas;

DELETE FROM public.race_uci_results WHERE id IN (SELECT id FROM private.retirada_backfill_20261008_race_uci_results);
DELETE FROM public.race_uci_stages WHERE id IN (SELECT id FROM private.retirada_backfill_20261008_race_uci_stages);
DELETE FROM public.race_uci_links WHERE "raceId" IN (SELECT "raceId" FROM private.retirada_backfill_20261008_race_uci_links);
DELETE FROM public.race_days WHERE id IN (SELECT id FROM private.retirada_backfill_20261008_race_days);
DELETE FROM public.races WHERE id IN (SELECT id FROM private.retirada_backfill_20261008_races);
DELETE FROM public.race_series WHERE id IN (SELECT id FROM private.retirada_backfill_20261008_race_series);
DELETE FROM public.rider_team_affiliations WHERE id IN (SELECT id FROM private.retirada_backfill_20261008_rider_team_affiliations);
DELETE FROM public.team_seasons WHERE id IN (SELECT id FROM private.retirada_backfill_20261008_team_seasons);
DELETE FROM private.uci_catalog_team_links l
USING private.retirada_backfill_20261008_uci_catalog_team_links b
WHERE l.season = b.season AND l.profile = b.profile
  AND l.gender IS NOT DISTINCT FROM b.gender AND l.team_id IS NOT DISTINCT FROM b.team_id;
DELETE FROM private.historical_participation_decisions;
DELETE FROM private.historical_team_roster_observations;
DELETE FROM private.rider_uci_profile_aliases a
USING private.retirada_backfill_20261008_rider_uci_profile_aliases b
WHERE a."riderGender" = b."riderGender" AND a."uciProfileId" = b."uciProfileId" AND a."riderId" = b."riderId";
DELETE FROM public.teams WHERE id IN (SELECT id FROM private.retirada_backfill_20261008_teams);
DELETE FROM public.riders_men WHERE id IN (SELECT id FROM private.retirada_backfill_20261008_riders_men);
DELETE FROM public.riders_women WHERE id IN (SELECT id FROM private.retirada_backfill_20261008_riders_women);


-- Comprobación: nada vigente cambia y no queda nada por borrar.
DO $$
DECLARE v_antes jsonb; v_despues jsonb; v_resto jsonb;
BEGIN
  SELECT m INTO v_antes FROM retirada_antes;
  SELECT m INTO v_despues FROM retirada_metricas;
  SELECT jsonb_build_object(
    'races_2020_2025', (SELECT count(*) FROM public.races WHERE year BETWEEN 2020 AND 2025),
    'teams_hco', (SELECT count(*) FROM public.teams WHERE "historicalCatalogOnly"),
    'men_hco', (SELECT count(*) FROM public.riders_men WHERE "historicalCatalogOnly"),
    'women_hco', (SELECT count(*) FROM public.riders_women WHERE "historicalCatalogOnly"),
    'seasons_2020_2025', (SELECT count(*) FROM public.team_seasons WHERE year BETWEEN 2020 AND 2025),
    'affil_2020_2025', (SELECT count(*) FROM public.rider_team_affiliations WHERE year BETWEEN 2020 AND 2025)) INTO v_resto;
  IF v_antes IS DISTINCT FROM v_despues THEN
    RAISE EXCEPTION 'Retirada abortada: cambian datos vigentes. antes=% despues=%', v_antes, v_despues;
  END IF;
  IF v_resto <> '{"races_2020_2025": 1, "teams_hco": 1, "men_hco": 18, "women_hco": 12, "seasons_2020_2025": 16, "affil_2020_2025": 10}'::jsonb THEN
    RAISE EXCEPTION 'Retirada abortada: residuo inesperado %', v_resto;
  END IF;
  --ENSAYO--
END $$;

DROP VIEW retirada_metricas;
