-- Tres reparaciones derivadas de la normalización de nombres de la Camp de
-- Morvedre (2026-10-04):
-- 1. Fusiona la ficha histórica garcia-frances-pablo (UCI 411897) en
--    garcia-pablo: misma persona (Pablo García Francés, 16-01-2001), alias
--    frances-garcia-pablo ya registrado. Repunta sus 3 observaciones
--    históricas de plantilla y traslada el perfil UCI a la superviviente.
--    La ficha origen, ya sin referencias ni perfil UCI, se borra en la
--    migración siguiente (repair_morvedre_followup_delete_20261005).
-- 2. Trofeo Matteotti 2026 (ONQJX6J3m8MDs9k3JuDK), Euskaltel-Euskadi: la
--    startlist tenía cruzados los dorsales 161, 163 y 165. Prevalece el
--    resultado oficial (161 Gotzon Martín 17.º, 165 Xabier Berasategi 18.º,
--    163 Mikel Bizkarra 71.º): se corrige la identidad de cada fila por
--    dorsal en startlist_riders y race_uci_results.
-- 3. Camp de Morvedre 2026, dorsal 175: la inscripción guardaba «Jimenez»;
--    se alinea con la ficha (López de Abetxuko).
-- Copia previa en private.repair_morvedre_followup_20261005_backup.

BEGIN;

CREATE TABLE private.repair_morvedre_followup_20261005_backup (
  entity text NOT NULL,
  row_key text NOT NULL,
  change_kind text NOT NULL,
  row_data jsonb NOT NULL,
  backed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (entity, row_key)
);
ALTER TABLE private.repair_morvedre_followup_20261005_backup ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE private.repair_morvedre_followup_20261005_backup
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT ON TABLE private.repair_morvedre_followup_20261005_backup
  TO service_role;

DO $preflight$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.riders_men WHERE id = 'garcia-frances-pablo'
      AND "uciProfileId" = '411897' AND "birthDate" = '2001-01-16'
      AND source = 'uci_historical' AND "identityKey" = 'frances-garcia-pablo') THEN
    RAISE EXCEPTION 'La ficha origen garcia-frances-pablo cambió desde la auditoría';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.riders_men WHERE id = 'garcia-pablo'
      AND "uciProfileId" IS NULL AND "birthDate" = '2001-01-16' AND nationality = 'es') THEN
    RAISE EXCEPTION 'La ficha superviviente garcia-pablo cambió desde la auditoría';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.rider_identity_aliases
      WHERE "aliasKey" = 'frances-garcia-pablo' AND gender = 'male' AND "riderId" = 'garcia-pablo') THEN
    RAISE EXCEPTION 'Falta el alias frances-garcia-pablo -> garcia-pablo';
  END IF;
  IF (SELECT count(*) FROM public.race_uci_results WHERE "globalRiderId" = 'garcia-frances-pablo')
   + (SELECT count(*) FROM public.startlist_riders WHERE "globalRiderId" = 'garcia-frances-pablo')
   + (SELECT count(*) FROM public.rider_team_affiliations WHERE "riderId" = 'garcia-frances-pablo')
   + (SELECT count(*) FROM public.rider_transfers WHERE "riderId" = 'garcia-frances-pablo')
   + (SELECT count(*) FROM public.rider_identity_aliases WHERE "riderId" = 'garcia-frances-pablo')
   + (SELECT count(*) FROM private.rider_uci_profile_aliases WHERE "riderId" = 'garcia-frances-pablo') <> 0
   OR (SELECT count(*) FROM private.historical_team_roster_observations WHERE "riderId" = 'garcia-frances-pablo') <> 3 THEN
    RAISE EXCEPTION 'Las referencias de garcia-frances-pablo cambiaron desde la auditoría';
  END IF;

  IF (SELECT count(*) FROM public.startlist_riders WHERE "raceId" = 'ONQJX6J3m8MDs9k3JuDK'
      AND (id, dorsal, "globalRiderId") IN (
        ('8922d450-a3af-475e-a97e-8e937fc7f3c5', 161, 'bizkarra-mikel'),
        ('c6da1d71-0c5f-49e3-9f9b-d084554b97a0', 163, 'berasategi-xabier'),
        ('9505a552-3456-43a2-ba4b-6b1866be8311', 165, 'martin-gotzon'))) <> 3 THEN
    RAISE EXCEPTION 'La startlist del Matteotti cambió desde la auditoría';
  END IF;
  IF (SELECT count(*) FROM public.race_uci_results WHERE "raceId" = 'ONQJX6J3m8MDs9k3JuDK'
      AND (id, bib, "globalRiderId") IN (
        (5659769, '161', 'bizkarra-mikel'),
        (5659823, '163', 'berasategi-xabier'),
        (5659770, '165', 'martin-gotzon'))) <> 3
   OR (SELECT count(*) FROM public.race_uci_results WHERE "raceId" = 'ONQJX6J3m8MDs9k3JuDK'
      AND "globalRiderId" IN ('bizkarra-mikel','berasategi-xabier','martin-gotzon')) <> 3 THEN
    RAISE EXCEPTION 'Los resultados del Matteotti cambiaron desde la auditoría';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.startlist_riders WHERE id = 'sruci_63175c94c09d5421fd2e5b147c3a54f3'
      AND "raceId" = 'FoJNjtj1ex8AemXhlGmo' AND dorsal = 175
      AND "globalRiderId" = 'jimenez-andoni' AND "lastName" = 'Jimenez') THEN
    RAISE EXCEPTION 'La inscripción de Andoni cambió desde la auditoría';
  END IF;
END
$preflight$;

-- Copia previa
INSERT INTO private.repair_morvedre_followup_20261005_backup (entity, row_key, change_kind, row_data)
SELECT 'riders_men', id, CASE id WHEN 'garcia-frances-pablo' THEN 'delete' ELSE 'update' END, to_jsonb(r)
FROM public.riders_men r WHERE id IN ('garcia-frances-pablo','garcia-pablo');

INSERT INTO private.repair_morvedre_followup_20261005_backup (entity, row_key, change_kind, row_data)
SELECT 'historical_team_roster_observations',
       concat_ws(':', year, "uciTeamProfileId", "uciRiderProfileId", "observationType"), 'update', to_jsonb(o)
FROM private.historical_team_roster_observations o WHERE "riderId" = 'garcia-frances-pablo';

INSERT INTO private.repair_morvedre_followup_20261005_backup (entity, row_key, change_kind, row_data)
SELECT 'startlist_riders', id, 'update', to_jsonb(sr) FROM public.startlist_riders sr
WHERE id IN ('8922d450-a3af-475e-a97e-8e937fc7f3c5','c6da1d71-0c5f-49e3-9f9b-d084554b97a0',
             '9505a552-3456-43a2-ba4b-6b1866be8311','sruci_63175c94c09d5421fd2e5b147c3a54f3');

INSERT INTO private.repair_morvedre_followup_20261005_backup (entity, row_key, change_kind, row_data)
SELECT 'race_uci_results', id::text, 'update', to_jsonb(r) FROM public.race_uci_results r
WHERE id IN (5659769, 5659823, 5659770);

-- 1. Fusión garcia-frances-pablo -> garcia-pablo
UPDATE private.historical_team_roster_observations
SET "riderId" = 'garcia-pablo' WHERE "riderId" = 'garcia-frances-pablo';

UPDATE public.riders_men SET "uciProfileId" = NULL, "updatedAt" = now()
WHERE id = 'garcia-frances-pablo';

UPDATE public.riders_men SET "uciProfileId" = '411897', "updatedAt" = now()
WHERE id = 'garcia-pablo';

-- 2. Matteotti: identidad por dorsal según el resultado oficial
UPDATE public.startlist_riders sr
SET "globalRiderId" = v.rider, "firstName" = v.first_name, "lastName" = v.last_name
FROM (VALUES
  ('8922d450-a3af-475e-a97e-8e937fc7f3c5', 'martin-gotzon', 'Gotzon', 'Martín'),
  ('c6da1d71-0c5f-49e3-9f9b-d084554b97a0', 'bizkarra-mikel', 'Mikel', 'Bizkarra'),
  ('9505a552-3456-43a2-ba4b-6b1866be8311', 'berasategi-xabier', 'Xabier', 'Berasategi')
) v(id, rider, first_name, last_name)
WHERE sr.id = v.id;

UPDATE public.race_uci_results r
SET "globalRiderId" = v.rider
FROM (VALUES (5659769, 'martin-gotzon'), (5659823, 'bizkarra-mikel'), (5659770, 'berasategi-xabier'))
  v(id, rider)
WHERE r.id = v.id;

-- 3. Andoni López de Abetxuko
UPDATE public.startlist_riders SET "lastName" = 'López de Abetxuko'
WHERE id = 'sruci_63175c94c09d5421fd2e5b147c3a54f3';

DO $verify$
BEGIN
  IF EXISTS (SELECT 1 FROM private.historical_team_roster_observations WHERE "riderId" = 'garcia-frances-pablo')
     OR NOT EXISTS (SELECT 1 FROM public.riders_men WHERE id = 'garcia-pablo' AND "uciProfileId" = '411897')
     OR (SELECT count(*) FROM private.historical_team_roster_observations WHERE "riderId" = 'garcia-pablo') <> 3 THEN
    RAISE EXCEPTION 'La fusión de Pablo García no quedó en el estado esperado';
  END IF;

  IF (SELECT count(*) FROM public.startlist_riders sr JOIN public.race_uci_results r
        ON r."raceId" = sr."raceId" AND r.bib = sr.dorsal::text AND r."globalRiderId" = sr."globalRiderId"
      WHERE sr."raceId" = 'ONQJX6J3m8MDs9k3JuDK' AND sr.dorsal IN (161, 163, 165)) <> 3
     OR NOT EXISTS (SELECT 1 FROM public.race_uci_results WHERE id = 5659769 AND rank = 17 AND "globalRiderId" = 'martin-gotzon')
     OR NOT EXISTS (SELECT 1 FROM public.race_uci_results WHERE id = 5659770 AND rank = 18 AND "globalRiderId" = 'berasategi-xabier')
     OR NOT EXISTS (SELECT 1 FROM public.race_uci_results WHERE id = 5659823 AND rank = 71 AND "globalRiderId" = 'bizkarra-mikel') THEN
    RAISE EXCEPTION 'El Matteotti no quedó en el estado esperado';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.startlist_riders_resolved
      WHERE id = 'sruci_63175c94c09d5421fd2e5b147c3a54f3' AND "lastName" = 'López de Abetxuko')
     OR NOT EXISTS (SELECT 1 FROM public.startlist_riders
      WHERE id = 'sruci_63175c94c09d5421fd2e5b147c3a54f3' AND "lastName" = 'López de Abetxuko') THEN
    RAISE EXCEPTION 'La inscripción de Andoni no quedó en el estado esperado';
  END IF;

  IF (SELECT count(*) FROM private.repair_morvedre_followup_20261005_backup) <> 12 THEN
    RAISE EXCEPTION 'El backup no contiene las 12 filas esperadas';
  END IF;
END
$verify$;

COMMIT;
