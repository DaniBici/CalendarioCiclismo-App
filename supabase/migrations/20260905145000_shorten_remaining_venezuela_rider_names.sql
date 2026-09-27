-- Aplica la misma separación entre nombre de uso y forma completa a las cuatro
-- fichas creadas para las CRI de Venezuela que ya tenían la grafía correcta.
BEGIN;

CREATE TABLE private.venezuela_cn_remaining_short_names_20260905_backup (
  gender text NOT NULL CHECK (gender IN ('male', 'female')),
  rider_id text NOT NULL,
  row_data jsonb NOT NULL,
  replacement jsonb NOT NULL,
  backed_up_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (gender, rider_id)
);

ALTER TABLE private.venezuela_cn_remaining_short_names_20260905_backup ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE private.venezuela_cn_remaining_short_names_20260905_backup
  FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON TABLE private.venezuela_cn_remaining_short_names_20260905_backup
  TO service_role;

COMMENT ON TABLE private.venezuela_cn_remaining_short_names_20260905_backup IS
  'Estado anterior al recorte de las cuatro fichas restantes de las CRI del Campeonato de Venezuela 2026.';

DO $$
DECLARE
  v_matching_profiles integer;
  v_alias_conflicts integer;
  v_result_rows integer;
  v_linked_results integer;
  v_startlist_refs integer;
BEGIN
  WITH expected(gender, rider_id, old_first, old_last, old_identity_key) AS (VALUES
    ('male', 'cuadros-ruiz-arley-alexander', 'Arley Alexander', 'Cuadros Ruiz', 'alexander-arley-cuadros-ruiz'),
    ('female', 'candelas-sanabria-fabiana-katherine', 'Fabiana Katherine', 'Candelas Sanabria', 'candelas-fabiana-katherine-sanabria'),
    ('female', 'ruiz-depablos-krisbely-angileht', 'Krisbely Angileht', 'Ruíz Depablos', 'angileht-depablos-krisbely-ruiz'),
    ('female', 'zambrano-olarte-shantal-anabella', 'Shantal Anabella', 'Zambrano Olarte', 'anabella-olarte-shantal-zambrano')
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
   AND p."otherNames" IS NULL
   AND p."identityKey" = e.old_identity_key;

  WITH future_aliases(gender, rider_id, alias_key) AS (VALUES
    ('male', 'cuadros-ruiz-arley-alexander', 'alexander-arley-cuadros-ruiz'),
    ('female', 'candelas-sanabria-fabiana-katherine', 'candelas-fabiana-katherine-sanabria'),
    ('female', 'ruiz-depablos-krisbely-angileht', 'angileht-depablos-krisbely-ruiz'),
    ('female', 'zambrano-olarte-shantal-anabella', 'anabella-olarte-shantal-zambrano')
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

  IF v_matching_profiles <> 4
     OR v_alias_conflicts <> 0
     OR v_result_rows <> 18
     OR v_linked_results <> 18
     OR v_startlist_refs <> 40
  THEN
    RAISE EXCEPTION
      'venezuela_cn_remaining_names_precondition_changed: profiles %, alias_conflicts %, results %, linked %, startlist_refs %',
      v_matching_profiles, v_alias_conflicts,
      v_result_rows, v_linked_results, v_startlist_refs;
  END IF;
END;
$$;

WITH expected(gender, rider_id, new_first, new_last, new_other) AS (VALUES
  ('male', 'cuadros-ruiz-arley-alexander', 'Arley Alexander', 'Cuadros', 'Arley Alexander Cuadros Ruiz'),
  ('female', 'candelas-sanabria-fabiana-katherine', 'Fabiana Katherine', 'Candelas', 'Fabiana Katherine Candelas Sanabria'),
  ('female', 'ruiz-depablos-krisbely-angileht', 'Krisbely Angileht', 'Ruíz', 'Krisbely Angileht Ruíz Depablos'),
  ('female', 'zambrano-olarte-shantal-anabella', 'Shantal Anabella', 'Zambrano', 'Shantal Anabella Zambrano Olarte')
), profiles AS (
  SELECT 'male'::text AS gender, id, to_jsonb(riders_men) AS row_data
  FROM public.riders_men
  UNION ALL
  SELECT 'female'::text AS gender, id, to_jsonb(riders_women) AS row_data
  FROM public.riders_women
)
INSERT INTO private.venezuela_cn_remaining_short_names_20260905_backup(
  gender, rider_id, row_data, replacement
)
SELECT e.gender, e.rider_id, p.row_data,
       jsonb_build_object(
         'firstName', e.new_first,
         'lastName', e.new_last,
         'otherNames', e.new_other
       )
FROM expected e
JOIN profiles p ON p.gender = e.gender AND p.id = e.rider_id;

INSERT INTO public.rider_identity_aliases("aliasKey", gender, "riderId", note)
VALUES
  ('alexander-arley-cuadros-ruiz', 'male', 'cuadros-ruiz-arley-alexander', 'Nombre completo anterior al recorte del Campeonato de Venezuela 2026'),
  ('candelas-fabiana-katherine-sanabria', 'female', 'candelas-sanabria-fabiana-katherine', 'Nombre completo anterior al recorte del Campeonato de Venezuela 2026'),
  ('angileht-depablos-krisbely-ruiz', 'female', 'ruiz-depablos-krisbely-angileht', 'Nombre completo anterior al recorte del Campeonato de Venezuela 2026'),
  ('anabella-olarte-shantal-zambrano', 'female', 'zambrano-olarte-shantal-anabella', 'Nombre completo anterior al recorte del Campeonato de Venezuela 2026');

UPDATE public.riders_men
SET "firstName" = 'Arley Alexander',
    "lastName" = 'Cuadros',
    "otherNames" = 'Arley Alexander Cuadros Ruiz',
    "updatedAt" = now()
WHERE id = 'cuadros-ruiz-arley-alexander';

WITH expected(rider_id, new_first, new_last, new_other) AS (VALUES
  ('candelas-sanabria-fabiana-katherine', 'Fabiana Katherine', 'Candelas', 'Fabiana Katherine Candelas Sanabria'),
  ('ruiz-depablos-krisbely-angileht', 'Krisbely Angileht', 'Ruíz', 'Krisbely Angileht Ruíz Depablos'),
  ('zambrano-olarte-shantal-anabella', 'Shantal Anabella', 'Zambrano', 'Shantal Anabella Zambrano Olarte')
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
  v_backup_rows integer;
  v_result_rows integer;
  v_linked_results integer;
  v_startlist_refs integer;
BEGIN
  WITH expected(gender, rider_id, new_first, new_last, new_other, new_identity_key) AS (VALUES
    ('male', 'cuadros-ruiz-arley-alexander', 'Arley Alexander', 'Cuadros', 'Arley Alexander Cuadros Ruiz', 'alexander-arley-cuadros'),
    ('female', 'candelas-sanabria-fabiana-katherine', 'Fabiana Katherine', 'Candelas', 'Fabiana Katherine Candelas Sanabria', 'candelas-fabiana-katherine'),
    ('female', 'ruiz-depablos-krisbely-angileht', 'Krisbely Angileht', 'Ruíz', 'Krisbely Angileht Ruíz Depablos', 'angileht-krisbely-ruiz'),
    ('female', 'zambrano-olarte-shantal-anabella', 'Shantal Anabella', 'Zambrano', 'Shantal Anabella Zambrano Olarte', 'anabella-shantal-zambrano')
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
    ('male', 'alexander-arley-cuadros-ruiz', 'cuadros-ruiz-arley-alexander'),
    ('female', 'candelas-fabiana-katherine-sanabria', 'candelas-sanabria-fabiana-katherine'),
    ('female', 'angileht-depablos-krisbely-ruiz', 'ruiz-depablos-krisbely-angileht'),
    ('female', 'anabella-olarte-shantal-zambrano', 'zambrano-olarte-shantal-anabella')
  );

  SELECT count(*) INTO v_backup_rows
  FROM private.venezuela_cn_remaining_short_names_20260905_backup;

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

  IF v_normalized_profiles <> 4
     OR v_long_aliases <> 4
     OR v_backup_rows <> 4
     OR v_result_rows <> 18
     OR v_linked_results <> 18
     OR v_startlist_refs <> 40
  THEN
    RAISE EXCEPTION
      'venezuela_cn_remaining_names_verification_failed: profiles %, long_aliases %, backups %, results %, linked %, startlist_refs %',
      v_normalized_profiles, v_long_aliases, v_backup_rows,
      v_result_rows, v_linked_results, v_startlist_refs;
  END IF;
END;
$$;

COMMIT;
