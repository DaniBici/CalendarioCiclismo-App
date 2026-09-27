-- Normaliza las fichas enlazadas a las CRI del Campeonato de Venezuela 2026.
-- Conserva los ids y referencias existentes; las claves de identidad retiradas
-- quedan como alias para impedir duplicados en futuras cargas de DataRide.
BEGIN;

CREATE TABLE private.venezuela_cn_rider_names_20260905_backup (
  gender text NOT NULL CHECK (gender IN ('male', 'female')),
  rider_id text NOT NULL,
  row_data jsonb NOT NULL,
  replacement jsonb NOT NULL,
  backed_up_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (gender, rider_id)
);

ALTER TABLE private.venezuela_cn_rider_names_20260905_backup ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE private.venezuela_cn_rider_names_20260905_backup
  FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON TABLE private.venezuela_cn_rider_names_20260905_backup
  TO service_role;

COMMENT ON TABLE private.venezuela_cn_rider_names_20260905_backup IS
  'Estado previo a la normalización autorizada de nombres de las CRI del Campeonato de Venezuela 2026.';

DO $$
DECLARE
  v_matching_profiles integer;
  v_result_rows integer;
  v_linked_results integer;
  v_startlist_refs integer;
  v_alias_conflicts integer;
BEGIN
  WITH expected(gender, rider_id, old_first, old_last, old_identity_key) AS (VALUES
    ('male', 'blanco-pirela-julio-cesar', 'Julio Cesar', 'Blanco Pirela', 'blanco-cesar-julio-pirela'),
    ('male', 'chacon-franklin', 'Franklin', 'Chacón', 'chacon-franklin'),
    ('male', 'gomez-urosa-luis', 'Luis', 'Gomez Urosa', 'gomez-luis-urosa'),
    ('male', 'goyo-pina-jesus-miguel', 'Jesus Miguel', 'Goyo Piña', 'goyo-jesus-miguel-pina'),
    ('male', 'lopez-colmenares-samuel-enrique', 'Samuel Enrique', 'Lopez Colmenares', 'colmenares-enrique-lopez-samuel'),
    ('male', 'mora-carrero-santiago-jose', 'Santiago Jose', 'Mora Carrero', 'carrero-jose-mora-santiago'),
    ('male', 'mora-luis', 'Luis', 'Mora', 'luis-mora'),
    ('male', 'pena-gonzalez-miguel-javier', 'Miguel Javier', 'Peña Gonzalez', 'gonzalez-javier-miguel-pena'),
    ('male', 'penuela-francisco-joel', 'Francisco', 'Peñuela', 'francisco-penuela'),
    ('male', 'sequera-sanchez-pedro-jose', 'Pedro Jose', 'Sequera Sanchez', 'jose-pedro-sanchez-sequera'),
    ('female', 'chacon-lilibeth', 'Lilibeth', 'Chacón', 'chacon-lilibeth'),
    ('female', 'roa-yeniret', 'Yeniret', 'Roa', 'roa-yeniret')
  ), profiles AS (
    SELECT 'male'::text AS gender, id, "firstName", "lastName", "identityKey"
    FROM public.riders_men
    UNION ALL
    SELECT 'female'::text AS gender, id, "firstName", "lastName", "identityKey"
    FROM public.riders_women
  )
  SELECT count(*) INTO v_matching_profiles
  FROM expected e
  JOIN profiles p
    ON p.gender = e.gender
   AND p.id = e.rider_id
   AND p."firstName" = e.old_first
   AND p."lastName" = e.old_last
   AND p."identityKey" = e.old_identity_key;

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

  WITH retiring(gender, rider_id, alias_key) AS (VALUES
    ('male', 'chacon-franklin', 'chacon-franklin'),
    ('male', 'gomez-urosa-luis', 'gomez-luis-urosa'),
    ('male', 'mora-luis', 'luis-mora'),
    ('male', 'penuela-francisco-joel', 'francisco-penuela'),
    ('female', 'chacon-lilibeth', 'chacon-lilibeth'),
    ('female', 'roa-yeniret', 'roa-yeniret')
  )
  SELECT count(*) INTO v_alias_conflicts
  FROM retiring r
  JOIN public.rider_identity_aliases a
    ON a.gender = r.gender
   AND a."aliasKey" = r.alias_key
   AND a."riderId" <> r.rider_id;

  IF v_matching_profiles <> 12
     OR v_result_rows <> 18
     OR v_linked_results <> 18
     OR v_startlist_refs <> 40
     OR v_alias_conflicts <> 0
  THEN
    RAISE EXCEPTION
      'venezuela_cn_rider_names_precondition_changed: profiles %, results %, linked %, startlist_refs %, alias_conflicts %',
      v_matching_profiles, v_result_rows, v_linked_results,
      v_startlist_refs, v_alias_conflicts;
  END IF;
END;
$$;

WITH expected(gender, rider_id, new_first, new_last, source_urls) AS (VALUES
  ('male', 'blanco-pirela-julio-cesar', 'Julio César', 'Blanco Pirela',
    ARRAY['https://example.invalid']),
  ('male', 'chacon-franklin', 'Franklin Alejandro', 'Chacón Ortega',
    ARRAY['https://example.invalid']),
  ('male', 'gomez-urosa-luis', 'Luis Antonio', 'Gómez Urosa',
    ARRAY['https://www.revistamundociclistico.com/2017/vuelta-a-venezuela-luis-antonio-gomez-vencedor-de-etapa-yonathan-monsalve-sigue-lider-cristian-torres-fue-tercero/']),
  ('male', 'goyo-pina-jesus-miguel', 'Jesús Miguel', 'Goyo Piña',
    ARRAY['https://example.invalid']),
  ('male', 'lopez-colmenares-samuel-enrique', 'Samuel Enrique', 'López Colmenares',
    ARRAY['https://example.invalid']),
  ('male', 'mora-carrero-santiago-jose', 'Santiago José', 'Mora Carrero',
    ARRAY['https://example.invalid']),
  ('male', 'mora-luis', 'Luis Guillermo', 'Mora Ramírez',
    ARRAY['https://lanacionweb.com/regional/contrarreloj-30/']),
  ('male', 'pena-gonzalez-miguel-javier', 'Miguel Javier', 'Peña González',
    ARRAY['https://example.invalid']),
  ('male', 'penuela-francisco-joel', 'Francisco Joel', 'Peñuela Sandoval',
    ARRAY['https://dataride.uci.org/iframe/RiderRankingDetails/1711810?disciplineSeasonId=464']),
  ('male', 'sequera-sanchez-pedro-jose', 'Pedro José', 'Sequera Sánchez',
    ARRAY['https://www.clarosports.com/ciclismo/clasico-rcn-2025-etapas-y-recorridos-oficiales-listas-de-corredores-y-donde-ver-en-vivo/']),
  ('female', 'chacon-lilibeth', 'Lilibeth de Carmen', 'Chacón García',
    ARRAY['https://www.uci.org/rider-details/77382']),
  ('female', 'roa-yeniret', 'Yeniret Alexandra', 'Roa Meléndez',
    ARRAY['https://lanacionweb.com/deportes/colonense-yeniret-roa-triunfa-en-la-mini-vuelta-nirgua/'])
), profiles AS (
  SELECT 'male'::text AS gender, id, to_jsonb(riders_men) AS row_data
  FROM public.riders_men
  UNION ALL
  SELECT 'female'::text AS gender, id, to_jsonb(riders_women) AS row_data
  FROM public.riders_women
)
INSERT INTO private.venezuela_cn_rider_names_20260905_backup(
  gender, rider_id, row_data, replacement
)
SELECT e.gender, e.rider_id, p.row_data,
       jsonb_build_object(
         'firstName', e.new_first,
         'lastName', e.new_last,
         'sourceUrls', to_jsonb(e.source_urls)
       )
FROM expected e
JOIN profiles p ON p.gender = e.gender AND p.id = e.rider_id;

INSERT INTO public.rider_identity_aliases("aliasKey", gender, "riderId", note)
VALUES
  ('chacon-franklin', 'male', 'chacon-franklin', 'Nombre abreviado anterior a la normalización del Campeonato de Venezuela 2026'),
  ('gomez-luis-urosa', 'male', 'gomez-urosa-luis', 'Nombre abreviado anterior a la normalización del Campeonato de Venezuela 2026'),
  ('luis-mora', 'male', 'mora-luis', 'Nombre abreviado anterior a la normalización del Campeonato de Venezuela 2026'),
  ('francisco-penuela', 'male', 'penuela-francisco-joel', 'Nombre abreviado anterior a la normalización del Campeonato de Venezuela 2026'),
  ('chacon-lilibeth', 'female', 'chacon-lilibeth', 'Nombre abreviado anterior a la normalización del Campeonato de Venezuela 2026'),
  ('roa-yeniret', 'female', 'roa-yeniret', 'Nombre abreviado anterior a la normalización del Campeonato de Venezuela 2026');

WITH expected(rider_id, new_first, new_last) AS (VALUES
  ('blanco-pirela-julio-cesar', 'Julio César', 'Blanco Pirela'),
  ('chacon-franklin', 'Franklin Alejandro', 'Chacón Ortega'),
  ('gomez-urosa-luis', 'Luis Antonio', 'Gómez Urosa'),
  ('goyo-pina-jesus-miguel', 'Jesús Miguel', 'Goyo Piña'),
  ('lopez-colmenares-samuel-enrique', 'Samuel Enrique', 'López Colmenares'),
  ('mora-carrero-santiago-jose', 'Santiago José', 'Mora Carrero'),
  ('mora-luis', 'Luis Guillermo', 'Mora Ramírez'),
  ('pena-gonzalez-miguel-javier', 'Miguel Javier', 'Peña González'),
  ('penuela-francisco-joel', 'Francisco Joel', 'Peñuela Sandoval'),
  ('sequera-sanchez-pedro-jose', 'Pedro José', 'Sequera Sánchez')
)
UPDATE public.riders_men AS rider
SET "firstName" = expected.new_first,
    "lastName" = expected.new_last,
    "updatedAt" = now()
FROM expected
WHERE rider.id = expected.rider_id;

WITH expected(rider_id, new_first, new_last) AS (VALUES
  ('chacon-lilibeth', 'Lilibeth de Carmen', 'Chacón García'),
  ('roa-yeniret', 'Yeniret Alexandra', 'Roa Meléndez')
)
UPDATE public.riders_women AS rider
SET "firstName" = expected.new_first,
    "lastName" = expected.new_last,
    "updatedAt" = now()
FROM expected
WHERE rider.id = expected.rider_id;

DO $$
DECLARE
  v_normalized_profiles integer;
  v_aliases integer;
  v_backup_rows integer;
  v_result_rows integer;
  v_linked_results integer;
  v_startlist_refs integer;
BEGIN
  WITH expected(gender, rider_id, new_first, new_last, new_identity_key) AS (VALUES
    ('male', 'blanco-pirela-julio-cesar', 'Julio César', 'Blanco Pirela', 'blanco-cesar-julio-pirela'),
    ('male', 'chacon-franklin', 'Franklin Alejandro', 'Chacón Ortega', 'alejandro-chacon-franklin-ortega'),
    ('male', 'gomez-urosa-luis', 'Luis Antonio', 'Gómez Urosa', 'antonio-gomez-luis-urosa'),
    ('male', 'goyo-pina-jesus-miguel', 'Jesús Miguel', 'Goyo Piña', 'goyo-jesus-miguel-pina'),
    ('male', 'lopez-colmenares-samuel-enrique', 'Samuel Enrique', 'López Colmenares', 'colmenares-enrique-lopez-samuel'),
    ('male', 'mora-carrero-santiago-jose', 'Santiago José', 'Mora Carrero', 'carrero-jose-mora-santiago'),
    ('male', 'mora-luis', 'Luis Guillermo', 'Mora Ramírez', 'guillermo-luis-mora-ramirez'),
    ('male', 'pena-gonzalez-miguel-javier', 'Miguel Javier', 'Peña González', 'gonzalez-javier-miguel-pena'),
    ('male', 'penuela-francisco-joel', 'Francisco Joel', 'Peñuela Sandoval', 'francisco-joel-penuela-sandoval'),
    ('male', 'sequera-sanchez-pedro-jose', 'Pedro José', 'Sequera Sánchez', 'jose-pedro-sanchez-sequera'),
    ('female', 'chacon-lilibeth', 'Lilibeth de Carmen', 'Chacón García', 'carmen-chacon-de-garcia-lilibeth'),
    ('female', 'roa-yeniret', 'Yeniret Alexandra', 'Roa Meléndez', 'alexandra-melendez-roa-yeniret')
  ), profiles AS (
    SELECT 'male'::text AS gender, id, "firstName", "lastName", "identityKey"
    FROM public.riders_men
    UNION ALL
    SELECT 'female'::text AS gender, id, "firstName", "lastName", "identityKey"
    FROM public.riders_women
  )
  SELECT count(*) INTO v_normalized_profiles
  FROM expected e
  JOIN profiles p
    ON p.gender = e.gender
   AND p.id = e.rider_id
   AND p."firstName" = e.new_first
   AND p."lastName" = e.new_last
   AND p."identityKey" = e.new_identity_key;

  SELECT count(*) INTO v_aliases
  FROM public.rider_identity_aliases
  WHERE (gender, "aliasKey", "riderId") IN (
    ('male', 'chacon-franklin', 'chacon-franklin'),
    ('male', 'gomez-luis-urosa', 'gomez-urosa-luis'),
    ('male', 'luis-mora', 'mora-luis'),
    ('male', 'francisco-penuela', 'penuela-francisco-joel'),
    ('female', 'chacon-lilibeth', 'chacon-lilibeth'),
    ('female', 'roa-yeniret', 'roa-yeniret')
  );

  SELECT count(*) INTO v_backup_rows
  FROM private.venezuela_cn_rider_names_20260905_backup;

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
     OR v_aliases <> 6
     OR v_backup_rows <> 12
     OR v_result_rows <> 18
     OR v_linked_results <> 18
     OR v_startlist_refs <> 40
  THEN
    RAISE EXCEPTION
      'venezuela_cn_rider_names_verification_failed: profiles %, aliases %, backups %, results %, linked %, startlist_refs %',
      v_normalized_profiles, v_aliases, v_backup_rows,
      v_result_rows, v_linked_results, v_startlist_refs;
  END IF;
END;
$$;

COMMIT;
