-- Conserva el nombre de uso en la ficha y mueve las formas completas verificadas
-- a otherNames para las CRI del Campeonato de Venezuela 2026.
BEGIN;

CREATE TABLE private.venezuela_cn_rider_short_names_20260905_backup (
  gender text NOT NULL CHECK (gender IN ('male', 'female')),
  rider_id text NOT NULL,
  row_data jsonb NOT NULL,
  alias_rows jsonb NOT NULL,
  replacement jsonb NOT NULL,
  backed_up_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (gender, rider_id)
);

ALTER TABLE private.venezuela_cn_rider_short_names_20260905_backup ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE private.venezuela_cn_rider_short_names_20260905_backup
  FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON TABLE private.venezuela_cn_rider_short_names_20260905_backup
  TO service_role;

COMMENT ON TABLE private.venezuela_cn_rider_short_names_20260905_backup IS
  'Estado anterior a separar nombres de uso y formas completas de las CRI del Campeonato de Venezuela 2026.';

DO $$
DECLARE
  v_matching_profiles integer;
  v_existing_aliases integer;
  v_alias_conflicts integer;
  v_result_rows integer;
  v_linked_results integer;
  v_startlist_refs integer;
BEGIN
  WITH expected(gender, rider_id, old_first, old_last, old_other, old_identity_key) AS (VALUES
    ('male', 'blanco-pirela-julio-cesar', 'Julio César', 'Blanco Pirela', NULL::text, 'blanco-cesar-julio-pirela'),
    ('male', 'chacon-franklin', 'Franklin Alejandro', 'Chacón Ortega', 'Franklin Chacón Ortega', 'alejandro-chacon-franklin-ortega'),
    ('male', 'gomez-urosa-luis', 'Luis Antonio', 'Gómez Urosa', NULL::text, 'antonio-gomez-luis-urosa'),
    ('male', 'goyo-pina-jesus-miguel', 'Jesús Miguel', 'Goyo Piña', NULL::text, 'goyo-jesus-miguel-pina'),
    ('male', 'lopez-colmenares-samuel-enrique', 'Samuel Enrique', 'López Colmenares', NULL::text, 'colmenares-enrique-lopez-samuel'),
    ('male', 'mora-carrero-santiago-jose', 'Santiago José', 'Mora Carrero', NULL::text, 'carrero-jose-mora-santiago'),
    ('male', 'mora-luis', 'Luis Guillermo', 'Mora Ramírez', NULL::text, 'guillermo-luis-mora-ramirez'),
    ('male', 'pena-gonzalez-miguel-javier', 'Miguel Javier', 'Peña González', NULL::text, 'gonzalez-javier-miguel-pena'),
    ('male', 'penuela-francisco-joel', 'Francisco Joel', 'Peñuela Sandoval', 'Joel', 'francisco-joel-penuela-sandoval'),
    ('male', 'sequera-sanchez-pedro-jose', 'Pedro José', 'Sequera Sánchez', NULL::text, 'jose-pedro-sanchez-sequera'),
    ('female', 'chacon-lilibeth', 'Lilibeth de Carmen', 'Chacón García', NULL::text, 'carmen-chacon-de-garcia-lilibeth'),
    ('female', 'roa-yeniret', 'Yeniret Alexandra', 'Roa Meléndez', 'Yeniret Alexandra Roa Melendez', 'alexandra-melendez-roa-yeniret')
  ), profiles AS (
    SELECT 'male'::text AS gender, id, "firstName", "lastName", "otherNames", "identityKey"
    FROM public.riders_men
    UNION ALL
    SELECT 'female'::text AS gender, id, "firstName", "lastName", "otherNames", "identityKey"
    FROM public.riders_women
  )
  SELECT count(*) INTO v_matching_profiles
  FROM expected e
  JOIN profiles p
    ON p.gender = e.gender
   AND p.id = e.rider_id
   AND p."firstName" = e.old_first
   AND p."lastName" = e.old_last
   AND p."otherNames" IS NOT DISTINCT FROM e.old_other
   AND p."identityKey" = e.old_identity_key;

  SELECT count(*) INTO v_existing_aliases
  FROM public.rider_identity_aliases
  WHERE (gender, "aliasKey", "riderId") IN (
    ('male', 'chacon-franklin', 'chacon-franklin'),
    ('male', 'gomez-luis-urosa', 'gomez-urosa-luis'),
    ('male', 'luis-mora', 'mora-luis'),
    ('male', 'francisco-penuela', 'penuela-francisco-joel'),
    ('female', 'chacon-lilibeth', 'chacon-lilibeth'),
    ('female', 'roa-yeniret', 'roa-yeniret')
  );

  WITH future_aliases(gender, rider_id, alias_key) AS (VALUES
    ('male', 'blanco-pirela-julio-cesar', 'blanco-cesar-julio-pirela'),
    ('male', 'chacon-franklin', 'alejandro-chacon-franklin-ortega'),
    ('male', 'gomez-urosa-luis', 'antonio-gomez-luis-urosa'),
    ('male', 'goyo-pina-jesus-miguel', 'goyo-jesus-miguel-pina'),
    ('male', 'lopez-colmenares-samuel-enrique', 'colmenares-enrique-lopez-samuel'),
    ('male', 'mora-carrero-santiago-jose', 'carrero-jose-mora-santiago'),
    ('male', 'mora-luis', 'guillermo-luis-mora-ramirez'),
    ('male', 'pena-gonzalez-miguel-javier', 'gonzalez-javier-miguel-pena'),
    ('male', 'penuela-francisco-joel', 'francisco-joel-penuela-sandoval'),
    ('male', 'sequera-sanchez-pedro-jose', 'jose-pedro-sanchez-sequera'),
    ('female', 'chacon-lilibeth', 'carmen-chacon-de-garcia-lilibeth'),
    ('female', 'roa-yeniret', 'alexandra-melendez-roa-yeniret')
  )
  SELECT count(*) INTO v_alias_conflicts
  FROM future_aliases f
  JOIN public.rider_identity_aliases a
    ON a.gender = f.gender
   AND a."aliasKey" = f.alias_key
   AND a."riderId" <> f.rider_id;

  SELECT count(*), count(*) FILTER (WHERE "globalRiderId" IS NOT NULL)
  INTO v_result_rows, v_linked_results
  FROM public.race_uci_results
  WHERE "raceId" IN (
    '2c0b7693-8064-4b72-941f-7d5a077a3a46',
    'b2d500df-8ab7-4095-8bbd-a55189ad78d9',
    '9252d422-9e1b-4f0c-b9b5-4aa800008039',
    'e861cc94-c9c6-4d60-8f8e-47ff075fbc7f'
  );

  SELECT count(*) INTO v_startlist_refs
  FROM public.startlist_riders
  WHERE "globalRiderId" IN (
    'blanco-pirela-julio-cesar', 'chacon-franklin',
    'cuadros-ruiz-arley-alexander', 'gomez-urosa-luis',
    'goyo-pina-jesus-miguel', 'lopez-colmenares-samuel-enrique',
    'mora-carrero-santiago-jose', 'mora-luis',
    'pena-gonzalez-miguel-javier', 'penuela-francisco-joel',
    'sequera-sanchez-pedro-jose',
    'candelas-sanabria-fabiana-katherine', 'chacon-lilibeth',
    'roa-yeniret', 'ruiz-depablos-krisbely-angileht',
    'zambrano-olarte-shantal-anabella'
  );

  IF v_matching_profiles <> 12
     OR v_existing_aliases <> 6
     OR v_alias_conflicts <> 0
     OR v_result_rows <> 18
     OR v_linked_results <> 18
     OR v_startlist_refs <> 40
  THEN
    RAISE EXCEPTION
      'venezuela_cn_short_names_precondition_changed: profiles %, existing_aliases %, alias_conflicts %, results %, linked %, startlist_refs %',
      v_matching_profiles, v_existing_aliases, v_alias_conflicts,
      v_result_rows, v_linked_results, v_startlist_refs;
  END IF;
END;
$$;

WITH expected(gender, rider_id, new_first, new_last, new_other) AS (VALUES
  ('male', 'blanco-pirela-julio-cesar', 'Julio César', 'Blanco', 'Julio César Blanco Pirela'),
  ('male', 'chacon-franklin', 'Franklin', 'Chacón', E'Franklin Chacón Ortega\nFranklin Alejandro Chacón Ortega'),
  ('male', 'gomez-urosa-luis', 'Luis', 'Gómez', E'Luis Gómez Urosa\nLuis Antonio Gómez Urosa'),
  ('male', 'goyo-pina-jesus-miguel', 'Jesús Miguel', 'Goyo', 'Jesús Miguel Goyo Piña'),
  ('male', 'lopez-colmenares-samuel-enrique', 'Samuel Enrique', 'López', 'Samuel Enrique López Colmenares'),
  ('male', 'mora-carrero-santiago-jose', 'Santiago José', 'Mora', 'Santiago José Mora Carrero'),
  ('male', 'mora-luis', 'Luis', 'Mora', 'Luis Guillermo Mora Ramírez'),
  ('male', 'pena-gonzalez-miguel-javier', 'Miguel Javier', 'Peña', 'Miguel Javier Peña González'),
  ('male', 'penuela-francisco-joel', 'Francisco', 'Peñuela', E'Joel\nFrancisco Joel Peñuela Sandoval'),
  ('male', 'sequera-sanchez-pedro-jose', 'Pedro José', 'Sequera', 'Pedro José Sequera Sánchez'),
  ('female', 'chacon-lilibeth', 'Lilibeth', 'Chacón', 'Lilibeth de Carmen Chacón García'),
  ('female', 'roa-yeniret', 'Yeniret', 'Roa', 'Yeniret Alexandra Roa Meléndez')
), profiles AS (
  SELECT 'male'::text AS gender, id, to_jsonb(riders_men) AS row_data
  FROM public.riders_men
  UNION ALL
  SELECT 'female'::text AS gender, id, to_jsonb(riders_women) AS row_data
  FROM public.riders_women
), aliases AS (
  SELECT e.gender, e.rider_id,
         COALESCE(
           jsonb_agg(to_jsonb(a) ORDER BY a."aliasKey")
             FILTER (WHERE a."aliasKey" IS NOT NULL),
           '[]'::jsonb
         ) AS alias_rows
  FROM expected e
  LEFT JOIN public.rider_identity_aliases a
    ON a.gender = e.gender
   AND a."riderId" = e.rider_id
  GROUP BY e.gender, e.rider_id
)
INSERT INTO private.venezuela_cn_rider_short_names_20260905_backup(
  gender, rider_id, row_data, alias_rows, replacement
)
SELECT e.gender, e.rider_id, p.row_data, a.alias_rows,
       jsonb_build_object(
         'firstName', e.new_first,
         'lastName', e.new_last,
         'otherNames', e.new_other
       )
FROM expected e
JOIN profiles p ON p.gender = e.gender AND p.id = e.rider_id
JOIN aliases a ON a.gender = e.gender AND a.rider_id = e.rider_id;

INSERT INTO public.rider_identity_aliases("aliasKey", gender, "riderId", note)
VALUES
  ('blanco-cesar-julio-pirela', 'male', 'blanco-pirela-julio-cesar', 'Nombre completo anterior al recorte del Campeonato de Venezuela 2026'),
  ('alejandro-chacon-franklin-ortega', 'male', 'chacon-franklin', 'Nombre completo anterior al recorte del Campeonato de Venezuela 2026'),
  ('antonio-gomez-luis-urosa', 'male', 'gomez-urosa-luis', 'Nombre completo anterior al recorte del Campeonato de Venezuela 2026'),
  ('goyo-jesus-miguel-pina', 'male', 'goyo-pina-jesus-miguel', 'Nombre completo anterior al recorte del Campeonato de Venezuela 2026'),
  ('colmenares-enrique-lopez-samuel', 'male', 'lopez-colmenares-samuel-enrique', 'Nombre completo anterior al recorte del Campeonato de Venezuela 2026'),
  ('carrero-jose-mora-santiago', 'male', 'mora-carrero-santiago-jose', 'Nombre completo anterior al recorte del Campeonato de Venezuela 2026'),
  ('guillermo-luis-mora-ramirez', 'male', 'mora-luis', 'Nombre completo anterior al recorte del Campeonato de Venezuela 2026'),
  ('gonzalez-javier-miguel-pena', 'male', 'pena-gonzalez-miguel-javier', 'Nombre completo anterior al recorte del Campeonato de Venezuela 2026'),
  ('francisco-joel-penuela-sandoval', 'male', 'penuela-francisco-joel', 'Nombre completo anterior al recorte del Campeonato de Venezuela 2026'),
  ('jose-pedro-sanchez-sequera', 'male', 'sequera-sanchez-pedro-jose', 'Nombre completo anterior al recorte del Campeonato de Venezuela 2026'),
  ('carmen-chacon-de-garcia-lilibeth', 'female', 'chacon-lilibeth', 'Nombre completo anterior al recorte del Campeonato de Venezuela 2026'),
  ('alexandra-melendez-roa-yeniret', 'female', 'roa-yeniret', 'Nombre completo anterior al recorte del Campeonato de Venezuela 2026');

DELETE FROM public.rider_identity_aliases
WHERE (gender, "aliasKey", "riderId", note) IN (
  ('male', 'chacon-franklin', 'chacon-franklin', 'Nombre abreviado anterior a la normalización del Campeonato de Venezuela 2026'),
  ('male', 'luis-mora', 'mora-luis', 'Nombre abreviado anterior a la normalización del Campeonato de Venezuela 2026'),
  ('male', 'francisco-penuela', 'penuela-francisco-joel', 'Nombre abreviado anterior a la normalización del Campeonato de Venezuela 2026'),
  ('female', 'chacon-lilibeth', 'chacon-lilibeth', 'Nombre abreviado anterior a la normalización del Campeonato de Venezuela 2026'),
  ('female', 'roa-yeniret', 'roa-yeniret', 'Nombre abreviado anterior a la normalización del Campeonato de Venezuela 2026')
);

WITH expected(rider_id, new_first, new_last, new_other) AS (VALUES
  ('blanco-pirela-julio-cesar', 'Julio César', 'Blanco', 'Julio César Blanco Pirela'),
  ('chacon-franklin', 'Franklin', 'Chacón', E'Franklin Chacón Ortega\nFranklin Alejandro Chacón Ortega'),
  ('gomez-urosa-luis', 'Luis', 'Gómez', E'Luis Gómez Urosa\nLuis Antonio Gómez Urosa'),
  ('goyo-pina-jesus-miguel', 'Jesús Miguel', 'Goyo', 'Jesús Miguel Goyo Piña'),
  ('lopez-colmenares-samuel-enrique', 'Samuel Enrique', 'López', 'Samuel Enrique López Colmenares'),
  ('mora-carrero-santiago-jose', 'Santiago José', 'Mora', 'Santiago José Mora Carrero'),
  ('mora-luis', 'Luis', 'Mora', 'Luis Guillermo Mora Ramírez'),
  ('pena-gonzalez-miguel-javier', 'Miguel Javier', 'Peña', 'Miguel Javier Peña González'),
  ('penuela-francisco-joel', 'Francisco', 'Peñuela', E'Joel\nFrancisco Joel Peñuela Sandoval'),
  ('sequera-sanchez-pedro-jose', 'Pedro José', 'Sequera', 'Pedro José Sequera Sánchez')
)
UPDATE public.riders_men AS rider
SET "firstName" = expected.new_first,
    "lastName" = expected.new_last,
    "otherNames" = expected.new_other,
    "updatedAt" = now()
FROM expected
WHERE rider.id = expected.rider_id;

WITH expected(rider_id, new_first, new_last, new_other) AS (VALUES
  ('chacon-lilibeth', 'Lilibeth', 'Chacón', 'Lilibeth de Carmen Chacón García'),
  ('roa-yeniret', 'Yeniret', 'Roa', 'Yeniret Alexandra Roa Meléndez')
)
UPDATE public.riders_women AS rider
SET "firstName" = expected.new_first,
    "lastName" = expected.new_last,
    "otherNames" = expected.new_other,
    "updatedAt" = now()
FROM expected
WHERE rider.id = expected.rider_id;

DO $$
DECLARE
  v_normalized_profiles integer;
  v_long_aliases integer;
  v_redundant_aliases integer;
  v_backup_rows integer;
  v_result_rows integer;
  v_linked_results integer;
  v_startlist_refs integer;
BEGIN
  WITH expected(gender, rider_id, new_first, new_last, new_other, new_identity_key) AS (VALUES
    ('male', 'blanco-pirela-julio-cesar', 'Julio César', 'Blanco', 'Julio César Blanco Pirela', 'blanco-cesar-julio'),
    ('male', 'chacon-franklin', 'Franklin', 'Chacón', E'Franklin Chacón Ortega\nFranklin Alejandro Chacón Ortega', 'chacon-franklin'),
    ('male', 'gomez-urosa-luis', 'Luis', 'Gómez', E'Luis Gómez Urosa\nLuis Antonio Gómez Urosa', 'gomez-luis'),
    ('male', 'goyo-pina-jesus-miguel', 'Jesús Miguel', 'Goyo', 'Jesús Miguel Goyo Piña', 'goyo-jesus-miguel'),
    ('male', 'lopez-colmenares-samuel-enrique', 'Samuel Enrique', 'López', 'Samuel Enrique López Colmenares', 'enrique-lopez-samuel'),
    ('male', 'mora-carrero-santiago-jose', 'Santiago José', 'Mora', 'Santiago José Mora Carrero', 'jose-mora-santiago'),
    ('male', 'mora-luis', 'Luis', 'Mora', 'Luis Guillermo Mora Ramírez', 'luis-mora'),
    ('male', 'pena-gonzalez-miguel-javier', 'Miguel Javier', 'Peña', 'Miguel Javier Peña González', 'javier-miguel-pena'),
    ('male', 'penuela-francisco-joel', 'Francisco', 'Peñuela', E'Joel\nFrancisco Joel Peñuela Sandoval', 'francisco-penuela'),
    ('male', 'sequera-sanchez-pedro-jose', 'Pedro José', 'Sequera', 'Pedro José Sequera Sánchez', 'jose-pedro-sequera'),
    ('female', 'chacon-lilibeth', 'Lilibeth', 'Chacón', 'Lilibeth de Carmen Chacón García', 'chacon-lilibeth'),
    ('female', 'roa-yeniret', 'Yeniret', 'Roa', 'Yeniret Alexandra Roa Meléndez', 'roa-yeniret')
  ), profiles AS (
    SELECT 'male'::text AS gender, id, "firstName", "lastName", "otherNames", "identityKey"
    FROM public.riders_men
    UNION ALL
    SELECT 'female'::text AS gender, id, "firstName", "lastName", "otherNames", "identityKey"
    FROM public.riders_women
  )
  SELECT count(*) INTO v_normalized_profiles
  FROM expected e
  JOIN profiles p
    ON p.gender = e.gender
   AND p.id = e.rider_id
   AND p."firstName" = e.new_first
   AND p."lastName" = e.new_last
   AND p."otherNames" = e.new_other
   AND p."identityKey" = e.new_identity_key;

  SELECT count(*) INTO v_long_aliases
  FROM public.rider_identity_aliases
  WHERE (gender, "aliasKey", "riderId") IN (
    ('male', 'blanco-cesar-julio-pirela', 'blanco-pirela-julio-cesar'),
    ('male', 'alejandro-chacon-franklin-ortega', 'chacon-franklin'),
    ('male', 'antonio-gomez-luis-urosa', 'gomez-urosa-luis'),
    ('male', 'goyo-jesus-miguel-pina', 'goyo-pina-jesus-miguel'),
    ('male', 'colmenares-enrique-lopez-samuel', 'lopez-colmenares-samuel-enrique'),
    ('male', 'carrero-jose-mora-santiago', 'mora-carrero-santiago-jose'),
    ('male', 'guillermo-luis-mora-ramirez', 'mora-luis'),
    ('male', 'gonzalez-javier-miguel-pena', 'pena-gonzalez-miguel-javier'),
    ('male', 'francisco-joel-penuela-sandoval', 'penuela-francisco-joel'),
    ('male', 'jose-pedro-sanchez-sequera', 'sequera-sanchez-pedro-jose'),
    ('female', 'carmen-chacon-de-garcia-lilibeth', 'chacon-lilibeth'),
    ('female', 'alexandra-melendez-roa-yeniret', 'roa-yeniret')
  );

  SELECT count(*) INTO v_redundant_aliases
  FROM public.rider_identity_aliases
  WHERE (gender, "aliasKey", "riderId") IN (
    ('male', 'chacon-franklin', 'chacon-franklin'),
    ('male', 'luis-mora', 'mora-luis'),
    ('male', 'francisco-penuela', 'penuela-francisco-joel'),
    ('female', 'chacon-lilibeth', 'chacon-lilibeth'),
    ('female', 'roa-yeniret', 'roa-yeniret')
  );

  SELECT count(*) INTO v_backup_rows
  FROM private.venezuela_cn_rider_short_names_20260905_backup;

  SELECT count(*), count(*) FILTER (WHERE "globalRiderId" IS NOT NULL)
  INTO v_result_rows, v_linked_results
  FROM public.race_uci_results
  WHERE "raceId" IN (
    '2c0b7693-8064-4b72-941f-7d5a077a3a46',
    'b2d500df-8ab7-4095-8bbd-a55189ad78d9',
    '9252d422-9e1b-4f0c-b9b5-4aa800008039',
    'e861cc94-c9c6-4d60-8f8e-47ff075fbc7f'
  );

  SELECT count(*) INTO v_startlist_refs
  FROM public.startlist_riders
  WHERE "globalRiderId" IN (
    'blanco-pirela-julio-cesar', 'chacon-franklin',
    'cuadros-ruiz-arley-alexander', 'gomez-urosa-luis',
    'goyo-pina-jesus-miguel', 'lopez-colmenares-samuel-enrique',
    'mora-carrero-santiago-jose', 'mora-luis',
    'pena-gonzalez-miguel-javier', 'penuela-francisco-joel',
    'sequera-sanchez-pedro-jose',
    'candelas-sanabria-fabiana-katherine', 'chacon-lilibeth',
    'roa-yeniret', 'ruiz-depablos-krisbely-angileht',
    'zambrano-olarte-shantal-anabella'
  );

  IF v_normalized_profiles <> 12
     OR v_long_aliases <> 12
     OR v_redundant_aliases <> 0
     OR v_backup_rows <> 12
     OR v_result_rows <> 18
     OR v_linked_results <> 18
     OR v_startlist_refs <> 40
  THEN
    RAISE EXCEPTION
      'venezuela_cn_short_names_verification_failed: profiles %, long_aliases %, redundant_aliases %, backups %, results %, linked %, startlist_refs %',
      v_normalized_profiles, v_long_aliases, v_redundant_aliases,
      v_backup_rows, v_result_rows, v_linked_results, v_startlist_refs;
  END IF;
END;
$$;

COMMIT;
