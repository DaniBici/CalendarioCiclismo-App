-- Prueba de integración reversible. Ejecutar íntegra por MCP; siempre ROLLBACK.
BEGIN;
INSERT INTO public.races(id,name,gender,"year","startDate","endDate")
VALUES ('zz-test-startlist-pipeline','Prueba importación transaccional','female',2026,'2026-09-04','2026-09-04');
DO $$
DECLARE
  doc jsonb := '{"raceId":"zz-test-startlist-pipeline","expectedRiderCount":2,"teams":[
    {"teamName":"ZZ Pipeline Club 498cf6","riders":[{"dorsal":1,"firstName":"Zztestalpha498cf6","lastName":"Pipeline498cf6","countryCode":"es"}]},
    {"teamName":"ZZ Pipeline National Selection 498cf6","riders":[{"dorsal":2,"firstName":"Zztestbeta498cf6","lastName":"Pipeline498cf6","countryCode":"fr","birthDate":"2000-02-29"}]}]}';
  prepared jsonb; applied jsonb; retry jsonb; saved_ids text[]; current_ids text[];
BEGIN
  IF (SELECT "enrichedStartlist" FROM public.races WHERE id='zz-test-startlist-pipeline') IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'La compatibilidad de enriquecimiento no es constante';
  END IF;
  BEGIN
    PERFORM public.ingest_startlist('zz-test-startlist-pipeline','female','[]');
    RAISE EXCEPTION 'La ingesta mínima sigue disponible';
  EXCEPTION WHEN feature_not_supported THEN NULL; END;
  prepared := public.prepare_startlist_import('zz-test-startlist-pipeline',doc);
  IF (prepared->>'ready')::boolean OR NOT prepared->'issues' @> '[{"code":"MISSING_BIRTH_DATE","dorsal":1}]' THEN
    RAISE EXCEPTION 'No bloquea el alta sin fecha: %',prepared;
  END IF;
  applied := public.apply_startlist_import((prepared->>'importId')::uuid);
  IF applied->>'status' <> 'prepared' OR EXISTS(SELECT 1 FROM public.teams WHERE name LIKE 'ZZ Pipeline%498cf6') THEN
    RAISE EXCEPTION 'La preparación pendiente ha escrito datos públicos';
  END IF;
  BEGIN
    PERFORM public.apply_startlist_import((prepared->>'importId')::uuid,'{"riders":{"99":{"birthDate":"2000-01-01"}}}');
    RAISE EXCEPTION 'No rechaza un dorsal ajeno';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM = 'No rechaza un dorsal ajeno' THEN RAISE; END IF; END;
  applied := public.apply_startlist_import((prepared->>'importId')::uuid,'{"riders":{"1":{"birthDate":"2001-01-02"}}}');
  IF applied->>'status' <> 'applied' OR applied->>'createdRiders' <> '2' OR applied->>'createdTeams' <> '2' THEN
    RAISE EXCEPTION 'Aplicación incorrecta: %',applied;
  END IF;
  IF (SELECT count(*) FROM public.riders_women WHERE "firstName" LIKE 'Zztest%498cf6' AND "birthDate" IS NOT NULL AND nationality IS NOT NULL) <> 2 THEN
    RAISE EXCEPTION 'Altas incompletas';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.riders_women r JOIN public.teams t ON t.id=r."currentTeamId"
                 WHERE r."firstName"='Zztestalpha498cf6' AND t.category='CLUBW')
     OR EXISTS (SELECT 1 FROM public.riders_women
                WHERE "firstName"='Zztestbeta498cf6' AND "currentTeamId" IS NOT NULL) THEN
    RAISE EXCEPTION 'No se distingue afiliación automática de club y convocatoria de selección';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.teams WHERE name='ZZ Pipeline National Selection 498cf6' AND "teamKind"='selection')
     OR NOT EXISTS(SELECT 1 FROM public.teams WHERE name='ZZ Pipeline Club 498cf6' AND "teamKind"='club') THEN
    RAISE EXCEPTION 'Tipo de equipo incorrecto';
  END IF;
  retry := public.apply_startlist_import((prepared->>'importId')::uuid);
  IF retry->>'alreadyApplied' <> 'true' THEN RAISE EXCEPTION 'Reintento no idempotente'; END IF;
  SELECT array_agg(id ORDER BY dorsal) INTO saved_ids FROM public.startlist_riders WHERE "raceId"='zz-test-startlist-pipeline';
  doc := jsonb_set(doc,'{teams,0,riders,0,birthDate}','"2001-01-02"');
  prepared := public.prepare_startlist_import('zz-test-startlist-pipeline',doc,true);
  IF NOT (prepared->>'ready')::boolean THEN RAISE EXCEPTION 'No reutiliza las fichas creadas: %',prepared; END IF;
  applied := public.apply_startlist_import((prepared->>'importId')::uuid);
  SELECT array_agg(id ORDER BY dorsal) INTO current_ids FROM public.startlist_riders WHERE "raceId"='zz-test-startlist-pipeline';
  IF current_ids IS DISTINCT FROM saved_ids OR applied->>'createdRiders' <> '0' THEN RAISE EXCEPTION 'No conserva filas/identidades'; END IF;
  prepared := public.prepare_startlist_import('zz-test-startlist-pipeline',doc);
  UPDATE public.startlist_riders SET "countryCode"='pt' WHERE "raceId"='zz-test-startlist-pipeline' AND dorsal=1;
  BEGIN
    PERFORM public.apply_startlist_import((prepared->>'importId')::uuid);
    RAISE EXCEPTION 'No detecta edición concurrente';
  EXCEPTION WHEN serialization_failure THEN NULL; END;
END;
$$;
ROLLBACK;
-- Un usuario autenticado no administrador no puede ejecutar ni leer borradores.
BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"}',true);
DO $$ BEGIN
  BEGIN
    PERFORM public.prepare_startlist_import('no-autorizado','{}');
    RAISE EXCEPTION 'Acepta un usuario sin administración';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    PERFORM public.get_startlist_import(gen_random_uuid());
    RAISE EXCEPTION 'Expone borradores sin administración';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END; $$;
ROLLBACK;
SELECT 'OK: preparación, altas, idempotencia, conservación, concurrencia y permisos' AS result;
