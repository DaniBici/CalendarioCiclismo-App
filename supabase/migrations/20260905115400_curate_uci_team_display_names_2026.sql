-- Adopta el contenido nominal del catálogo UCI 2026 con capitalización
-- editorial. La denominación literal en mayúsculas permanece como evidencia
-- en private.uci_catalog_team_links.source_name.

CREATE TABLE private.uci_team_curated_names_20260905_backup (
  uci_profile text PRIMARY KEY,
  team_id text NOT NULL UNIQUE,
  season integer NOT NULL,
  official_source_name text NOT NULL,
  curated_display_name text NOT NULL,
  teams_row jsonb NOT NULL,
  team_season_row jsonb NOT NULL,
  backed_up_at timestamptz NOT NULL DEFAULT now()
);

REVOKE ALL ON TABLE private.uci_team_curated_names_20260905_backup
  FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON TABLE private.uci_team_curated_names_20260905_backup
  TO service_role;

CREATE TEMP TABLE uci_team_curated_name_targets (
  uci_profile text PRIMARY KEY,
  display_name text NOT NULL
) ON COMMIT DROP;

INSERT INTO uci_team_curated_name_targets (uci_profile, display_name) VALUES
  ('21481', '4WD Rentacar - Facatativa'),
  ('21355', 'Anicolor/Campicarn'),
  ('21390', 'Aviludo - Louletano - Loulé'),
  ('21099', 'Baloise Verzekeringen - Het Poetsbureau Lions'),
  ('21116', 'BHS-PL Beton Bornholm'),
  ('21123', 'Bourg en Bresse Ain Cyclisme'),
  ('21146', 'Campana Imballaggi-Morbiato-Trentino'),
  ('21366', 'CLN - Kosova'),
  ('21380', 'Color Code-Alu Center'),
  ('21195', 'EF Education - Aevolo'),
  ('21113', 'Fany Gastro - Integray L27'),
  ('21108', 'FNIX-SCOM-Hengxiang Cycling Team'),
  ('21107', 'Huansheng-Vonoa-Taishan Sport Team'),
  ('21132', 'MaxSolar-Raymon'),
  ('21130', 'Red Bull - BORA - hansgrohe Rookies'),
  ('21129', 'REMBE | rad-net'),
  ('21399', 'Run&Race-Solarpur'),
  ('21110', 'Shenzhen Gineyea - Xidesheng Cycling Team'),
  ('21463', 'Solme Olmo Arvedi'),
  ('21235', 'St Michel - Preference Home - Auber93'),
  ('21101', 'Tarteletto - Isorex'),
  ('21148', 'UC Trevigiani Energiapura Marchiol'),
  ('21207', 'Aromitalia Vaiano'),
  ('21333', 'Vini Fantini - BePink'),
  ('21215', 'Virginia''s Blue Ridge TWENTY28'),
  ('20829', 'St Michel - Preference Home - Auber93'),
  ('20795', 'Burgos-Burpellet-BH'),
  ('20807', 'EF Education - EasyPost'),
  ('20794', 'Red Bull - BORA - hansgrohe'),
  ('21484', 'UAE Team Emirates XRG'),
  ('20843', 'EF Education - Oatly'),
  ('20806', 'FDJ United - SUEZ'),
  ('20835', 'Lidl - Trek'),
  ('20836', 'Liv-AlUla-Jayco'),
  ('21149', 'Aisan Racing Team'),
  ('21098', 'Alpecin-Premier Tech Development Team'),
  ('21106', 'Bahrain Victorious Development Team'),
  ('21363', 'Benediction Banafrica Team'),
  ('21124', 'Decathlon CMA CGM Development Team'),
  ('21163', 'EEW-VDK Cyclingteam'),
  ('21158', 'Energus Cycling Team'),
  ('21139', 'Groupama-FDJ United'),
  ('21361', 'GW Erco Sportfitnes'),
  ('21153', 'Kinan Racing Team'),
  ('21353', 'Konya Büyükşehir Belediye Spor'),
  ('21178', 'Lucky Sport Cycling Team'),
  ('21347', 'Meridian Racing p/b de la Uz'),
  ('21119', 'Movistar Team Academy'),
  ('21476', 'Muğla Büyükşehir Belediyesi Spor Kulübü'),
  ('21529', 'Netcompany INEOS Racing Academy'),
  ('21320', 'Nice Metropole Cote d''Azur'),
  ('21369', 'NSN Development Team'),
  ('21464', 'Obidos Cycling Team'),
  ('21133', 'P.A.S. Ioanninnon - P&I'),
  ('21367', 'Pio Rico Cycling Team'),
  ('21498', 'Prowheel Kung Shenzhen Cycling Team'),
  ('21122', 'SCO Dijon Team Materiel-Velo.com'),
  ('21157', 'Seoul Cycling Team'),
  ('21150', 'Shimano Racing Team'),
  ('21100', 'Soudal Quick-Step Devo Team'),
  ('21346', 'Spor Toto Cycling Team'),
  ('21395', 'Team Brennan'),
  ('21115', 'Team Coloquick'),
  ('21168', 'Team Drali - Repsol'),
  ('21127', 'Team Lotto Kern-Haus Outlet Montabaur'),
  ('21483', 'Team Medellin - EPM'),
  ('21111', 'Team Sistecredito'),
  ('21370', 'Team Storck - MRW Bau'),
  ('21469', 'Team Tavira / Crédito Agricola'),
  ('21322', 'Team Ukyo'),
  ('21136', 'Team United Shipping'),
  ('21160', 'Team Visma | Lease a Bike Development'),
  ('21096', 'Team Vorarlberg'),
  ('21229', 'Terengganu Cycling Team'),
  ('21175', 'Tudor Pro Cycling Team U23'),
  ('21381', 'TUFO - Pardus Prostejov'),
  ('21218', 'Vendee U Primeo Energie'),
  ('21170', 'Victoria Sports Pro Cycling'),
  ('21159', 'VolkerWessels Cycling Team'),
  ('21172', 'Voster Team'),
  ('21360', 'XDS Astana Development Team'),
  ('21231', 'AG Insurance Soudal Devo Team'),
  ('21198', 'Citymesh - Customm Pro Cycling Team'),
  ('21340', 'Dukla Women Cycling'),
  ('21359', 'Fenix-Premier Tech Development Team'),
  ('21202', 'Handsling Alba Development Road Team'),
  ('21212', 'Hitec Products-Fluid Control'),
  ('21209', 'Liv-AlUla-Jayco'),
  ('21204', 'LKT-Team'),
  ('21210', 'Minimax Cycling Team'),
  ('21383', 'Team Amani'),
  ('21332', 'Team Mendelspeck E-Work'),
  ('21326', 'Vendée Feminine RVC'),
  ('20827', 'Cofidis Women Team'),
  ('20804', 'Laboral Kutxa - Fundacion Euskadi'),
  ('20828', 'Lotto Intermarche Ladies'),
  ('20830', 'VolkerWessels Cycling Team'),
  ('20797', 'Equipo Kern Pharma'),
  ('20822', 'Modern Adventure Pro Cycling'),
  ('20823', 'Pinarello-Q36.5 Pro Cycling Team'),
  ('20799', 'Team Flanders - Baloise'),
  ('20800', 'Team Novo Nordisk'),
  ('20801', 'Team Polti VisitMalta'),
  ('20803', 'Tudor Pro Cycling Team'),
  ('20792', 'Decathlon CMA CGM Team'),
  ('20820', 'Movistar Team'),
  ('20818', 'NSN Cycling Team'),
  ('20812', 'Team Jayco AlUla'),
  ('20811', 'Team Picnic PostNL'),
  ('20813', 'Team Visma | Lease a Bike'),
  ('20816', 'XDS Astana Team'),
  ('20831', 'AG Insurance - Soudal Team'),
  ('20837', 'Movistar Team'),
  ('20838', 'Team Picnic PostNL'),
  ('20845', 'Team SD Worx - Protime'),
  ('20839', 'Team Visma | Lease a Bike');

DO $$
DECLARE
  v_count integer;
BEGIN
  SELECT count(*) INTO v_count FROM uci_team_curated_name_targets;
  IF v_count <> 116 THEN
    RAISE EXCEPTION 'Mapa editorial incompleto: esperadas 116 filas, obtenidas %', v_count;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM uci_team_curated_name_targets x
    LEFT JOIN private.uci_catalog_team_links l
      ON l.season = 2026
     AND l.profile = x.uci_profile
    LEFT JOIN private.uci_team_officialization_20260905_backup b
      ON b.uci_profile = x.uci_profile
    LEFT JOIN public.teams t ON t.id = l.team_id
    LEFT JOIN public.team_seasons s
      ON s."teamId" = l.team_id
     AND s.year = l.season
    WHERE l.profile IS NULL
       OR b.uci_profile IS NULL
       OR t.id IS NULL
       OR s.id IS NULL
       OR l.team_id IS DISTINCT FROM b.team_id
       OR t.name IS DISTINCT FROM b.teams_row->>'name'
       OR s.name IS DISTINCT FROM b.team_season_row->>'name'
       OR lower(regexp_replace(replace(x.display_name, 'İ', 'i'), '[^[:alnum:]]+', '', 'g'))
          IS DISTINCT FROM
          lower(regexp_replace(replace(b.official_name, 'İ', 'i'), '[^[:alnum:]]+', '', 'g'))
       OR x.display_name = upper(x.display_name)
  ) THEN
    RAISE EXCEPTION 'El mapa editorial no coincide con la fuente o con el estado restaurado';
  END IF;
END $$;

INSERT INTO private.uci_team_curated_names_20260905_backup (
  uci_profile,
  team_id,
  season,
  official_source_name,
  curated_display_name,
  teams_row,
  team_season_row
)
SELECT
  x.uci_profile,
  l.team_id,
  l.season,
  b.official_name,
  x.display_name,
  to_jsonb(t),
  to_jsonb(s)
FROM uci_team_curated_name_targets x
JOIN private.uci_catalog_team_links l
  ON l.season = 2026
 AND l.profile = x.uci_profile
JOIN private.uci_team_officialization_20260905_backup b
  ON b.uci_profile = x.uci_profile
JOIN public.teams t ON t.id = l.team_id
JOIN public.team_seasons s
  ON s."teamId" = l.team_id
 AND s.year = l.season;

UPDATE public.teams t
SET
  "nameAliases" = CASE
    WHEN NOT EXISTS (
      SELECT 1
      FROM regexp_split_to_table(COALESCE(t."nameAliases", ''), E'\n') AS a(alias)
      WHERE btrim(a.alias) = t.name
    )
      THEN concat_ws(E'\n', NULLIF(btrim(t."nameAliases"), ''), t.name)
    ELSE t."nameAliases"
  END,
  name = b.curated_display_name,
  "updatedAt" = now()
FROM private.uci_team_curated_names_20260905_backup b
WHERE t.id = b.team_id
  AND t.name IS DISTINCT FROM b.curated_display_name;

UPDATE public.team_seasons s
SET
  name = t.name,
  "nameAliases" = t."nameAliases",
  "updatedAt" = now()
FROM private.uci_team_curated_names_20260905_backup b
JOIN public.teams t ON t.id = b.team_id
WHERE s."teamId" = b.team_id
  AND s.year = b.season
  AND (s.name, s."nameAliases") IS DISTINCT FROM (t.name, t."nameAliases");

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM private.uci_team_curated_names_20260905_backup b
    JOIN public.teams t ON t.id = b.team_id
    JOIN public.team_seasons s
      ON s."teamId" = b.team_id
     AND s.year = b.season
    WHERE t.name IS DISTINCT FROM b.curated_display_name
       OR s.name IS DISTINCT FROM b.curated_display_name
       OR s."uciCode" IS DISTINCT FROM (
         SELECT l.source_code
         FROM private.uci_catalog_team_links l
         WHERE l.season = b.season
           AND l.profile = b.uci_profile
       )
       OR NOT (public.fold_team_name(b.curated_display_name) = ANY(t."foldedNames"))
       OR (
         b.teams_row->>'name' IS DISTINCT FROM t.name
         AND NOT EXISTS (
           SELECT 1
           FROM regexp_split_to_table(COALESCE(t."nameAliases", ''), E'\n') AS a(alias)
           WHERE btrim(a.alias) = b.teams_row->>'name'
         )
       )
  ) THEN
    RAISE EXCEPTION 'Falló la comprobación posterior de nombres, códigos o aliases';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM private.uci_team_officialization_20260905_backup b
    JOIN public.teams t ON t.id = b.team_id
    WHERE lower(regexp_replace(replace(t.name, 'İ', 'i'), '[^[:alnum:]]+', '', 'g'))
          IS DISTINCT FROM
          lower(regexp_replace(replace(b.official_name, 'İ', 'i'), '[^[:alnum:]]+', '', 'g'))
       OR (
         t.name = upper(t.name)
         AND t.name IS DISTINCT FROM b.official_name
       )
  ) THEN
    RAISE EXCEPTION 'Algún nombre 2026 no conserva el contenido UCI con capitalización editorial';
  END IF;
END $$;
