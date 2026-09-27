BEGIN;

CREATE TABLE private.repair_vuelta_ecuador_stage1_rider_links_20260908_backup (
  entity text NOT NULL,
  "rowKey" text NOT NULL,
  "rowData" jsonb,
  "backedUpAt" timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (entity, "rowKey")
);

COMMENT ON TABLE private.repair_vuelta_ecuador_stage1_rider_links_20260908_backup IS
  'Estado previo de los enlaces de identidad de los dorsales 33 y 136 de la etapa 1 de la Vuelta al Ecuador 2026.';

ALTER TABLE private.repair_vuelta_ecuador_stage1_rider_links_20260908_backup ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE private.repair_vuelta_ecuador_stage1_rider_links_20260908_backup
  FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON TABLE private.repair_vuelta_ecuador_stage1_rider_links_20260908_backup
  TO service_role;

INSERT INTO private.repair_vuelta_ecuador_stage1_rider_links_20260908_backup
  (entity, "rowKey", "rowData")
SELECT 'race_uci_results',
       rr."raceId" || ':' || rr."eventId"::text || ':' || rr.bib,
       to_jsonb(rr)
FROM public.race_uci_results rr
WHERE rr."raceId" = '9dsfkpQh9q25AHX9Zlpy'
  AND rr."eventId" = 380754
  AND rr.bib IN ('33', '136');

INSERT INTO private.repair_vuelta_ecuador_stage1_rider_links_20260908_backup
  (entity, "rowKey", "rowData")
SELECT 'riders_men', r.id, to_jsonb(r)
FROM public.riders_men r
WHERE r.id = 'zijlstra-youri';

DO $$
DECLARE
  v_new_rider_id text;
  v_identity_key text := public.compute_identity_key('Juan José', 'López Salcedo');
BEGIN
  IF (SELECT count(*) FROM private.repair_vuelta_ecuador_stage1_rider_links_20260908_backup
      WHERE entity = 'race_uci_results') <> 2 THEN
    RAISE EXCEPTION 'No se han respaldado las dos filas de resultados esperadas';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.race_uci_results
    WHERE "raceId" = '9dsfkpQh9q25AHX9Zlpy' AND "eventId" = 380754
      AND bib = '33' AND "riderDisplay" = 'ZIJLSTRA Youri'
      AND "globalRiderId" IS NULL
  ) OR NOT EXISTS (
    SELECT 1 FROM public.race_uci_results
    WHERE "raceId" = '9dsfkpQh9q25AHX9Zlpy' AND "eventId" = 380754
      AND bib = '136' AND "riderDisplay" = 'LOPEZ SALCEDO Juan Jose'
      AND irm = 'DSQ' AND "globalRiderId" IS NULL
  ) THEN
    RAISE EXCEPTION 'Las filas auditadas han cambiado';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.riders_men
    WHERE id = 'zijlstra-youri' AND "firstName" = 'Youri' AND "lastName" = 'Zijlstra'
      AND nationality = 'nl' AND "birthDate" = date '2007-02-06'
  ) THEN
    RAISE EXCEPTION 'La ficha verificada de Youri Zijlstra ha cambiado';
  END IF;

  IF EXISTS (SELECT 1 FROM public.riders_men WHERE "identityKey" = v_identity_key)
     OR EXISTS (SELECT 1 FROM public.riders_women WHERE "identityKey" = v_identity_key)
     OR EXISTS (
       SELECT 1 FROM public.rider_identity_aliases
       WHERE "aliasKey" = v_identity_key
     ) THEN
    RAISE EXCEPTION 'Ya existe una identidad o alias para Juan José López Salcedo';
  END IF;

  v_new_rider_id := regexp_replace(
    public.fold_name('López Salcedo') || '-' || public.fold_name('Juan José'),
    '[^a-z0-9]+', '-', 'g'
  );
  v_new_rider_id := trim(both '-' from v_new_rider_id);

  IF v_new_rider_id = ''
     OR EXISTS (SELECT 1 FROM public.riders_men WHERE id = v_new_rider_id)
     OR EXISTS (SELECT 1 FROM public.riders_women WHERE id = v_new_rider_id) THEN
    RAISE EXCEPTION 'El identificador calculado para Juan José López Salcedo no está disponible';
  END IF;

  INSERT INTO public.riders_men
    (id, "firstName", "lastName", nationality, "birthDate", source, verified, "identityKey")
  VALUES
    (v_new_rider_id, 'Juan José', 'López Salcedo', 'co', date '2005-07-22',
     'uci_results_repair', true, v_identity_key);

  UPDATE public.race_uci_results
  SET "globalRiderId" = 'zijlstra-youri'
  WHERE "raceId" = '9dsfkpQh9q25AHX9Zlpy' AND "eventId" = 380754
    AND bib = '33' AND "riderDisplay" = 'ZIJLSTRA Youri' AND "globalRiderId" IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No se ha enlazado el resultado de Youri Zijlstra';
  END IF;

  UPDATE public.race_uci_results
  SET "globalRiderId" = v_new_rider_id
  WHERE "raceId" = '9dsfkpQh9q25AHX9Zlpy' AND "eventId" = 380754
    AND bib = '136' AND "riderDisplay" = 'LOPEZ SALCEDO Juan Jose'
    AND irm = 'DSQ' AND "globalRiderId" IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No se ha enlazado el resultado de Juan José López Salcedo';
  END IF;
END;
$$;

COMMIT;

-- Rollback dirigido:
-- 1. Restaurar race_uci_results.globalRiderId desde rowData->>'globalRiderId'
--    para las dos claves guardadas en el backup.
-- 2. Eliminar la ficha creada de Juan José López Salcedo únicamente después de
--    comprobar que no conserva referencias fuera de este resultado.
