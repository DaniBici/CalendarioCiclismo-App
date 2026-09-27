-- Fixtures aislados; ejecutar completo mediante Supabase MCP. No conserva datos.
BEGIN;
INSERT INTO public.teams(id,name,gender,category) VALUES
  ('zz-dev-main','ZZ Matriz','male','WT'),
  ('zz-dev-child','ZZ Filial','male','CT'),
  ('zz-dev-sibling','ZZ Otra filial','male','CT'),
  ('zz-dev-unrelated','ZZ Independiente','male','CT'),
  ('zz-dev-women','ZZ Matriz femenina','female','WWT'),
  ('zz-dev-women-child','ZZ Filial femenina','female','CTW'),
  ('zz-dev-selection','ZZ Selección','male','NTM');
INSERT INTO public.teams(id,name,gender,category,"specialEdition","parentTeamId") VALUES
  ('zz-dev-jersey','ZZ Maillot matriz','male','WT',true,'zz-dev-main'),
  ('zz-dev-child-jersey','ZZ Maillot filial','male','CT',true,'zz-dev-child');
INSERT INTO public.races(id,name,gender,year,"startDate","endDate") VALUES
  ('zz-dev-race','ZZ Carrera filiales','male',2026,'2026-09-04','2026-09-06'),
  ('zz-dev-race-w','ZZ Carrera femenina filiales','female',2026,'2026-09-04','2026-09-06'),
  ('zz-dev-race-old','ZZ Carrera histórica filiales','male',2025,'2025-09-04','2025-09-06');
INSERT INTO public.team_development_links("mainTeamId","developmentTeamId",year,"sourceUrl") VALUES
  ('zz-dev-main','zz-dev-child',2026,'https://example.test/official'),
  ('zz-dev-main','zz-dev-sibling',2026,'https://example.test/official'),
  ('zz-dev-women','zz-dev-women-child',2026,'https://example.test/official');
INSERT INTO public.riders_men(id,"firstName","lastName",nationality,"birthDate","currentTeamId") VALUES
  ('zz-dev-rider-main','Zzmain','Zzfiliales','es','2000-01-01','zz-dev-main'),
  ('zz-dev-rider-child','Zzchild','Zzfiliales','es','2002-01-01','zz-dev-child'),
  ('zz-dev-rider-sibling','Zzsibling','Zzfiliales','es','2002-01-01','zz-dev-sibling'),
  ('zz-dev-rider-outside','Zzoutside','Zzfiliales','es','2002-01-01','zz-dev-unrelated'),
  ('zz-dev-rider-edition','Zzedition','Zzfiliales','es','2002-01-01','zz-dev-child-jersey'),
  ('zz-dev-rider-expired','Zzexpired','Zzfiliales','es','2002-01-01','zz-dev-child'),
  ('zz-dev-rider-future','Zzfuture','Zzfiliales','es','2002-01-01','zz-dev-child');
INSERT INTO public.riders_women(id,"firstName","lastName",nationality,"birthDate","currentTeamId") VALUES
  ('zz-dev-rider-w','Zzwomen','Zzfiliales','es','2002-01-01','zz-dev-women-child');
-- Las escrituras siguientes son exclusivamente fixtures transaccionales.
DELETE FROM public.rider_team_affiliations WHERE "riderId" LIKE 'zz-dev-rider-%';
INSERT INTO public.rider_team_affiliations(id,"riderId","riderGender","teamId",year,"dateFrom","dateTo") VALUES
  ('zz-dev-aff-main','zz-dev-rider-main','male','zz-dev-main',2026,NULL,NULL),
  ('zz-dev-aff-child','zz-dev-rider-child','male','zz-dev-child',2026,NULL,NULL),
  ('zz-dev-aff-duplicate','zz-dev-rider-child','male','zz-dev-main',2026,NULL,NULL),
  ('zz-dev-aff-sibling','zz-dev-rider-sibling','male','zz-dev-sibling',2026,NULL,NULL),
  ('zz-dev-aff-outside','zz-dev-rider-outside','male','zz-dev-unrelated',2026,NULL,NULL),
  ('zz-dev-aff-edition','zz-dev-rider-edition','male','zz-dev-child-jersey',2026,NULL,NULL),
  ('zz-dev-aff-expired','zz-dev-rider-expired','male','zz-dev-child',2026,NULL,'2026-09-03'),
  ('zz-dev-aff-future','zz-dev-rider-future','male','zz-dev-child',2026,'2026-09-07',NULL),
  ('zz-dev-aff-old-main','zz-dev-rider-main','male','zz-dev-main',2025,NULL,NULL),
  ('zz-dev-aff-old-child','zz-dev-rider-child','male','zz-dev-child',2025,NULL,NULL),
  ('zz-dev-aff-w','zz-dev-rider-w','female','zz-dev-women-child',2026,NULL,NULL);

DO $$
DECLARE main_roster jsonb; child_roster jsonb; old_roster jsonb;
  before_riders jsonb; after_riders jsonb; doc jsonb; prepared jsonb; applied jsonb;
BEGIN
  SELECT jsonb_agg(to_jsonb(m) ORDER BY id) INTO before_riders FROM public.riders_men m WHERE id LIKE 'zz-dev-rider-%';
  main_roster := public.startlist_team_roster('zz-dev-race','zz-dev-main');
  child_roster := public.startlist_team_roster('zz-dev-race','zz-dev-child');
  IF NOT main_roster @> '[{"id":"zz-dev-rider-child"},{"id":"zz-dev-rider-main"},{"id":"zz-dev-rider-sibling"},{"id":"zz-dev-rider-edition","rosterTeamId":"zz-dev-child"}]'
     OR NOT child_roster @> '[{"id":"zz-dev-rider-main"},{"id":"zz-dev-rider-child"},{"id":"zz-dev-rider-edition"}]' THEN
    RAISE EXCEPTION 'Falta consulta bidireccional: %, %',main_roster,child_roster;
  END IF;
  IF child_roster @> '[{"id":"zz-dev-rider-sibling"}]'
     OR main_roster @> '[{"id":"zz-dev-rider-outside"}]'
     OR main_roster @> '[{"id":"zz-dev-rider-expired"}]'
     OR main_roster @> '[{"id":"zz-dev-rider-future"}]' THEN
    RAISE EXCEPTION 'Consulta equipos ajenos o afiliaciones fuera de fecha';
  END IF;
  IF (SELECT count(*) FROM jsonb_array_elements(main_roster) r WHERE r->>'id'='zz-dev-rider-child') <> 1 THEN
    RAISE EXCEPTION 'Duplica un corredor presente en ambas plantillas';
  END IF;
  IF public.startlist_team_roster('zz-dev-race','zz-dev-jersey') IS DISTINCT FROM main_roster THEN
    RAISE EXCEPTION 'No resuelve el maillot especial a la identidad matriz';
  END IF;
  old_roster := public.startlist_team_roster('zz-dev-race-old','zz-dev-main');
  IF jsonb_array_length(old_roster) <> 1 OR NOT old_roster @> '[{"id":"zz-dev-rider-main"}]' THEN
    RAISE EXCEPTION 'Propaga el vínculo a otra temporada: %',old_roster;
  END IF;
  IF public.startlist_team_roster('zz-dev-race','zz-dev-selection') <> '[]'
     OR public.startlist_team_roster('zz-dev-race-w','zz-dev-main') <> '[]'
     OR NOT public.startlist_team_roster('zz-dev-race-w','zz-dev-women') @> '[{"id":"zz-dev-rider-w"}]' THEN
    RAISE EXCEPTION 'No respeta género/selecciones o no resuelve filiales femeninas';
  END IF;
  BEGIN
    INSERT INTO public.team_development_links("mainTeamId","developmentTeamId",year,"sourceUrl")
    VALUES('zz-dev-main','zz-dev-women',2026,'https://example.test/official');
    RAISE EXCEPTION 'Acepta géneros incompatibles';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN
    INSERT INTO public.team_development_links("mainTeamId","developmentTeamId",year,"sourceUrl")
    VALUES('zz-dev-child','zz-dev-main',2026,'https://example.test/official');
    RAISE EXCEPTION 'Acepta un ciclo';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN
    INSERT INTO public.team_development_links("mainTeamId","developmentTeamId",year,"sourceUrl")
    VALUES('zz-dev-main','zz-dev-jersey',2026,'https://example.test/official');
    RAISE EXCEPTION 'Acepta una edición especial como filial';
  EXCEPTION WHEN check_violation THEN NULL; END;
  -- El guardado cruza identidades sin reasignar al corredor de la filial.
  doc := '{"raceId":"zz-dev-race","expectedRiderCount":1,"teams":[{"teamId":"zz-dev-main","teamName":"ZZ Matriz","riders":[{"dorsal":1,"firstName":"Zzchild","lastName":"Zzfiliales","countryCode":"es"}]}]}';
  prepared := public.prepare_startlist_import('zz-dev-race',doc);
  IF prepared->>'ready' <> 'true' THEN RAISE EXCEPTION 'No identifica al corredor de la filial: %',prepared; END IF;
  applied := public.apply_startlist_import((prepared->>'importId')::uuid);
  IF applied->>'status' <> 'applied' OR NOT EXISTS (
    SELECT 1 FROM public.startlist_riders r JOIN public.startlist_teams t ON t.id=r."teamId"
    WHERE r."raceId"='zz-dev-race' AND r."globalRiderId"='zz-dev-rider-child' AND t."teamId"='zz-dev-main'
  ) THEN RAISE EXCEPTION 'No conserva el equipo inscrito al guardar'; END IF;
  SELECT jsonb_agg(to_jsonb(m) ORDER BY id) INTO after_riders FROM public.riders_men m WHERE id LIKE 'zz-dev-rider-%';
  IF before_riders IS DISTINCT FROM after_riders THEN RAISE EXCEPTION 'La consulta/inscripción modifica fichas'; END IF;
END;
$$;
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  BEGIN
    PERFORM public.startlist_team_roster('zz-dev-race','zz-dev-main');
    RAISE EXCEPTION 'La RPC permite consultar sin administración';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  IF EXISTS (SELECT 1 FROM public.team_development_links) THEN
    RAISE EXCEPTION 'La tabla expone vínculos a un usuario sin administración';
  END IF;
  BEGIN
    DELETE FROM public.team_development_links WHERE "developmentTeamId"='zz-dev-child';
    RAISE EXCEPTION 'Un usuario autenticado puede modificar vínculos';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END; $$;
SET LOCAL ROLE service_role;
DO $$ BEGIN
  IF NOT public.startlist_team_roster('zz-dev-race','zz-dev-main') @> '[{"id":"zz-dev-rider-child"}]' THEN
    RAISE EXCEPTION 'La RPC no es accesible para el servicio';
  END IF;
END; $$;
ROLLBACK;
SELECT 'OK: vínculos bidireccionales, temporalidad, identidad y permisos' AS result;
