-- Borra la ficha histórica garcia-frances-pablo, fusionada en garcia-pablo
-- por repair_morvedre_followup_20261005 (copia previa en
-- private.repair_morvedre_followup_20261005_backup, change_kind 'delete').

DO $preflight$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM private.repair_morvedre_followup_20261005_backup
      WHERE entity = 'riders_men' AND row_key = 'garcia-frances-pablo' AND change_kind = 'delete') THEN
    RAISE EXCEPTION 'Falta la copia previa de garcia-frances-pablo';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.riders_men WHERE id = 'garcia-frances-pablo' AND "uciProfileId" IS NULL)
     OR NOT EXISTS (SELECT 1 FROM public.riders_men WHERE id = 'garcia-pablo' AND "uciProfileId" = '411897') THEN
    RAISE EXCEPTION 'Las fichas no están en el estado esperado tras la fusión';
  END IF;
  IF (SELECT count(*) FROM public.race_uci_results WHERE "globalRiderId" = 'garcia-frances-pablo')
   + (SELECT count(*) FROM public.startlist_riders WHERE "globalRiderId" = 'garcia-frances-pablo')
   + (SELECT count(*) FROM public.rider_team_affiliations WHERE "riderId" = 'garcia-frances-pablo')
   + (SELECT count(*) FROM public.rider_transfers WHERE "riderId" = 'garcia-frances-pablo')
   + (SELECT count(*) FROM public.rider_identity_aliases WHERE "riderId" = 'garcia-frances-pablo')
   + (SELECT count(*) FROM private.rider_uci_profile_aliases WHERE "riderId" = 'garcia-frances-pablo')
   + (SELECT count(*) FROM private.historical_team_roster_observations WHERE "riderId" = 'garcia-frances-pablo') <> 0 THEN
    RAISE EXCEPTION 'garcia-frances-pablo conserva referencias';
  END IF;
END
$preflight$;

DELETE FROM public.riders_men WHERE id = 'garcia-frances-pablo';

DO $verify$
BEGIN
  IF EXISTS (SELECT 1 FROM public.riders_men WHERE id = 'garcia-frances-pablo') THEN
    RAISE EXCEPTION 'La ficha garcia-frances-pablo no se eliminó';
  END IF;
END
$verify$;
