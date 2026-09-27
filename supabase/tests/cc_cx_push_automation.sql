-- Sin invocar emisor, pg_net ni processScheduled; filas no visibles fuera de la transacción.
BEGIN;
GRANT cc_results_worker TO postgres WITH SET TRUE;
DO $$
DECLARE rid text:=gen_random_uuid()::text; today date:=(now() AT TIME ZONE 'Europe/Madrid')::date;
BEGIN
  PERFORM set_config('cc.cx_auto_push_race',rid,true);
  -- CDM: solo las pruebas premium (CM/CC/CDM o torneos Copa del Mundo/Superprestige/X2O) generan avisos.
  INSERT INTO public.cx_races(id,name,"nameEn",slug,"seasonKey","seasonStartYear","dateKey",class)
    VALUES(rid,'Prueba avisos','Push test',rid,'2026-27',2026,today,'CDM');
  INSERT INTO public.cx_race_categories("raceId",category,"startTimeUtc","durationFormat","durationRuleVersion")
    VALUES(rid,'ME',now()+interval '1 hour','individual','2026-07-01');
  INSERT INTO public.cx_race_categories("raceId",category,"startTimeUtc") VALUES(rid,'WE',now()+interval '1 hour');
END $$;
SET LOCAL ROLE cc_results_worker;
DO $$
DECLARE result jsonb;
BEGIN
  result:=private.cx_enqueue_automatic_pushes(now(),current_setting('cc.cx_auto_push_race'));
  IF result->>'scheduled'<>'2' THEN RAISE EXCEPTION 'Se omite una salida verificada o se inventa la de WE sin formato'; END IF;
  result:=private.cx_enqueue_automatic_pushes(now(),current_setting('cc.cx_auto_push_race'));
  IF result->>'scheduled'<>'0' OR result->>'updated'<>'0' THEN RAISE EXCEPTION 'Se duplican avisos en otro tick'; END IF;
END $$;
RESET ROLE;
DO $$
BEGIN
  IF EXISTS(SELECT 1 FROM public.scheduled_push_notifications WHERE "cxRaceId"=current_setting('cc.cx_auto_push_race')
    AND (category<>'cyclocross' OR "raceId" IS NOT NULL OR "raceDayId" IS NOT NULL OR cardinality("targetLanguages")<>1)) THEN
    RAISE EXCEPTION 'El aviso CX amplía público o mezcla carretera'; END IF;
  PERFORM set_config('cc.cx_auto_push_es',(SELECT "scheduledNotificationId" FROM private.cx_push_auto_dispatch
    WHERE "raceId"=current_setting('cc.cx_auto_push_race') AND "eventType"='start' AND language='es'),true);
  PERFORM set_config('cc.cx_auto_push_en',(SELECT "scheduledNotificationId" FROM private.cx_push_auto_dispatch
    WHERE "raceId"=current_setting('cc.cx_auto_push_race') AND "eventType"='start' AND language='en'),true);
  PERFORM set_config('cc.cx_auto_push_digest',md5(private.cx_auto_push_source(current_setting('cc.cx_auto_push_race'),'ME','start')::text),true);
  PERFORM set_config('TimeZone','Europe/Madrid',true);
  IF current_setting('cc.cx_auto_push_digest')<>md5(private.cx_auto_push_source(current_setting('cc.cx_auto_push_race'),'ME','start')::text) THEN
    RAISE EXCEPTION 'El digest varía con la zona del worker/emisor'; END IF;
  PERFORM set_config('TimeZone','UTC',true);
  UPDATE public.cx_race_categories SET "startTimeUtc"=now()+interval '2 hours' WHERE "raceId"=current_setting('cc.cx_auto_push_race') AND category='ME';
END $$;
SET LOCAL ROLE cc_results_worker;
DO $$
BEGIN
  IF private.cx_enqueue_automatic_pushes(now(),current_setting('cc.cx_auto_push_race'))->>'updated'<>'2' THEN RAISE EXCEPTION 'El horario corregido no reprograma ambos idiomas'; END IF;
END $$;
RESET ROLE;
SET LOCAL ROLE service_role;
DO $$
BEGIN
  IF public.cx_auto_push_is_available(current_setting('cc.cx_auto_push_es')) THEN RAISE EXCEPTION 'Un aviso se entrega antes de la ventana de salida'; END IF;
  IF public.cx_auto_push_is_available('no-existe') THEN RAISE EXCEPTION 'Aviso sin registro propio disponible'; END IF;
END $$;
RESET ROLE;
DO $$
BEGIN
  UPDATE public.cx_race_categories SET "startTimeUtc"=now()+interval '20 minutes' WHERE "raceId"=current_setting('cc.cx_auto_push_race') AND category='ME';
END $$;
SET LOCAL ROLE cc_results_worker;
SELECT private.cx_enqueue_automatic_pushes(now(),current_setting('cc.cx_auto_push_race'));
RESET ROLE;
SET LOCAL ROLE service_role;
DO $$
BEGIN
  IF NOT public.cx_auto_push_is_available(current_setting('cc.cx_auto_push_es')) OR NOT public.cx_auto_push_is_available(current_setting('cc.cx_auto_push_en')) THEN
    RAISE EXCEPTION 'Los dos avisos verificados y vencidos no están disponibles'; END IF;
END $$;
RESET ROLE;
DO $$
BEGIN
  UPDATE private.cx_push_auto_dispatch SET "validUntil"=now()-interval '1 minute' WHERE "scheduledNotificationId"=current_setting('cc.cx_auto_push_en');
END $$;
SET LOCAL ROLE service_role;
DO $$
BEGIN
  IF public.cx_auto_push_is_available(current_setting('cc.cx_auto_push_en')) THEN RAISE EXCEPTION 'Se entrega un evento vencido después de la franja nocturna'; END IF;
END $$;
RESET ROLE;
DO $$
BEGIN
  UPDATE private.cx_push_auto_dispatch SET "validUntil"=now()+interval '20 minutes' WHERE "scheduledNotificationId"=current_setting('cc.cx_auto_push_en');
  UPDATE public.cx_race_categories SET "dateKey"='2027-03-01' WHERE "raceId"=current_setting('cc.cx_auto_push_race') AND category='ME';
  IF private.cx_auto_push_source(current_setting('cc.cx_auto_push_race'),'ME','start') IS NOT NULL THEN RAISE EXCEPTION 'Una manga de marzo genera un aviso'; END IF;
  UPDATE public.cx_race_categories SET "dateKey"=NULL WHERE "raceId"=current_setting('cc.cx_auto_push_race') AND category='ME';
  UPDATE public.cx_races SET "endDateKey"='2027-03-01' WHERE id=current_setting('cc.cx_auto_push_race');
  IF private.cx_auto_push_source(current_setting('cc.cx_auto_push_race'),'ME','start') IS NOT NULL THEN RAISE EXCEPTION 'Una carrera que termina en marzo genera un aviso'; END IF;
  UPDATE public.cx_races SET "endDateKey"=NULL WHERE id=current_setting('cc.cx_auto_push_race');
  UPDATE public.scheduled_push_notifications SET status='cancelled' WHERE id=current_setting('cc.cx_auto_push_es');
  INSERT INTO public.cx_results("raceId",category,rank,"riderDisplay","timeSeconds") VALUES(current_setting('cc.cx_auto_push_race'),'ME',1,'A Prueba',3600);
  UPDATE public.cx_race_categories SET "resultsStatus"='provisional',"resultsImportedAt"=now(),"resultsSourceUrl"='https://official.test/results'
    WHERE "raceId"=current_setting('cc.cx_auto_push_race') AND category='ME';
END $$;
SET LOCAL ROLE cc_results_worker;
DO $$
BEGIN
  IF private.cx_enqueue_automatic_pushes(now(),current_setting('cc.cx_auto_push_race'))->>'scheduled'<>'0' THEN RAISE EXCEPTION 'Una provisional o un final estimado genera aviso de resultados'; END IF;
END $$;
RESET ROLE;
DO $$
BEGIN
  UPDATE public.cx_race_categories SET "resultsStatus"='official' WHERE "raceId"=current_setting('cc.cx_auto_push_race') AND category='ME';
END $$;
SET LOCAL ROLE cc_results_worker;
DO $$
BEGIN
  IF private.cx_enqueue_automatic_pushes(now(),current_setting('cc.cx_auto_push_race'))->>'scheduled'<>'2' THEN RAISE EXCEPTION 'No se encolan resultados oficiales por idioma'; END IF;
END $$;
RESET ROLE;
DO $$
BEGIN
  IF (SELECT count(*) FROM private.cx_push_auto_dispatch WHERE "raceId"=current_setting('cc.cx_auto_push_race'))<>4
    OR (SELECT status FROM public.scheduled_push_notifications WHERE id=current_setting('cc.cx_auto_push_es'))<>'cancelled' THEN
    RAISE EXCEPTION 'Se inventa otra manga o se rearma una cancelación administrativa'; END IF;
  UPDATE public.cx_race_categories SET "isCancelled"=true WHERE "raceId"=current_setting('cc.cx_auto_push_race') AND category='ME';
  INSERT INTO public.scheduled_push_notifications(id,title,"cxRaceId","deepLink",category,"scheduledAt",status,"createdBy")
    VALUES('manual-'||current_setting('cc.cx_auto_push_race'),'Aviso manual',current_setting('cc.cx_auto_push_race'),
      'cxRace/'||current_setting('cc.cx_auto_push_race'),'cyclocross',now()+interval '2 hours','pending','admin');
END $$;
SET LOCAL ROLE service_role;
DO $$
BEGIN
  IF public.cx_auto_push_is_available(current_setting('cc.cx_auto_push_en')) THEN RAISE EXCEPTION 'El emisor admite una manga cancelada'; END IF;
END $$;
RESET ROLE;
SET LOCAL ROLE cc_results_worker;
DO $$
DECLARE result jsonb;
BEGIN
  result:=private.cx_enqueue_automatic_pushes(now(),current_setting('cc.cx_auto_push_race'));
  IF result->>'cancelled'<>'3' THEN RAISE EXCEPTION 'Se mantienen avisos pendientes retirados'; END IF;
  IF has_table_privilege(current_user,'private.cx_push_auto_dispatch','UPDATE') OR has_table_privilege(current_user,'public.scheduled_push_notifications','INSERT') THEN
    RAISE EXCEPTION 'El worker escribe directamente en cola de envíos'; END IF;
END $$;
RESET ROLE;
DO $$
BEGIN
  IF (SELECT status FROM public.scheduled_push_notifications WHERE id='manual-'||current_setting('cc.cx_auto_push_race'))<>'pending' THEN
    RAISE EXCEPTION 'Se retira un aviso administrativo con el automático'; END IF;
  IF has_function_privilege('authenticated','private.cx_enqueue_automatic_pushes(timestamptz,text)','EXECUTE')
    OR has_function_privilege('anon','public.cx_auto_push_is_available(text)','EXECUTE')
    OR has_function_privilege('cc_results_worker','public.cx_auto_push_is_available(text)','EXECUTE')
    OR has_function_privilege('service_role','private.cx_enqueue_automatic_pushes(timestamptz,text)','EXECUTE') THEN
    RAISE EXCEPTION 'Se amplía el acceso al despacho privado'; END IF;
END $$;
-- No premium: un C2 sin torneo premium no programa salida ni resultados.
DO $$
DECLARE rid text:=gen_random_uuid()::text; today date:=(now() AT TIME ZONE 'Europe/Madrid')::date;
BEGIN
  PERFORM set_config('cc.cx_auto_push_nonpremium',rid,true);
  INSERT INTO public.cx_races(id,name,"nameEn",slug,"seasonKey","seasonStartYear","dateKey",class)
    VALUES(rid,'Prueba no premium','Non premium',rid,'2026-27',2026,today,'C2');
  INSERT INTO public.cx_race_categories("raceId",category,"startTimeUtc","durationFormat","durationRuleVersion","resultsStatus","resultsImportedAt","resultsSourceUrl")
    VALUES(rid,'ME',now()+interval '1 hour','individual','2026-07-01','official',now(),'https://official.test/nonpremium');
  INSERT INTO public.cx_results("raceId",category,rank,"riderDisplay","timeSeconds")
    VALUES(rid,'ME',1,'X No Premium',3600);
END $$;
SET LOCAL ROLE cc_results_worker;
DO $$
DECLARE result jsonb;
BEGIN
  result:=private.cx_enqueue_automatic_pushes(now(),current_setting('cc.cx_auto_push_nonpremium'));
  IF result->>'scheduled'<>'0' OR result->>'updated'<>'0' THEN RAISE EXCEPTION 'Una carrera no premium genera avisos'; END IF;
END $$;
RESET ROLE;
DO $$
BEGIN
  IF EXISTS(SELECT 1 FROM public.scheduled_push_notifications WHERE "cxRaceId"=current_setting('cc.cx_auto_push_nonpremium')) THEN
    RAISE EXCEPTION 'Una carrera no premium deja avisos en cola'; END IF;
  IF private.cx_auto_push_source(current_setting('cc.cx_auto_push_nonpremium'),'ME','start') IS NOT NULL
    OR private.cx_auto_push_source(current_setting('cc.cx_auto_push_nonpremium'),'ME','results') IS NOT NULL THEN
    RAISE EXCEPTION 'La fuente de una carrera no premium no es nula'; END IF;
END $$;
ROLLBACK;
