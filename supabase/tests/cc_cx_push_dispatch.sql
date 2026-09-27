-- F4: dispositivos inactivos y cola cancelada, todo con ROLLBACK; sin envíos.
BEGIN;
DO $$
DECLARE r text := gen_random_uuid()::text; admin_id text;
BEGIN
  SELECT user_id::text INTO STRICT admin_id FROM private.admin_users LIMIT 1;
  PERFORM set_config('cc.cx_push_race',r,true);
  PERFORM set_config('cc.cx_push_admin',admin_id,true);
  PERFORM set_config('cc.cx_push_token','cc-cx-test-'||gen_random_uuid()::text,true);
  INSERT INTO public.cx_races(id,name,slug,"seasonKey","seasonStartYear","dateKey",class)
    VALUES(r,'Prueba CX push',r,'2026-27',2026,'2026-11-01','C2');
END $$;
SET LOCAL ROLE anon;
DO $$
DECLARE sid text;
BEGIN
  sid := public.set_push_subscription_v4(current_setting('cc.cx_push_token'),'ios',false,'SPAIN','ES','es',
    ARRAY['general','results','cyclocross'],ARRAY[]::text[],ARRAY[]::text[],ARRAY[]::text[],ARRAY[current_setting('cc.cx_push_race')]);
  PERFORM set_config('cc.cx_push_subscription',sid,true);
END $$;
RESET ROLE;
DO $$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.push_subscription_categories WHERE "subscriptionId"=current_setting('cc.cx_push_subscription') AND category='cyclocross')
    OR NOT EXISTS(SELECT 1 FROM public.push_cx_race_subscriptions WHERE "subscriptionId"=current_setting('cc.cx_push_subscription') AND "raceId"=current_setting('cc.cx_push_race')) THEN
    RAISE EXCEPTION 'v4 no guarda la categoría y el seguimiento CX'; END IF;
  IF (SELECT "isActive" FROM public.push_subscriptions WHERE id=current_setting('cc.cx_push_subscription')) THEN
    RAISE EXCEPTION 'El dispositivo de prueba debe permanecer inactivo'; END IF;
  PERFORM public.set_push_subscription_v4(current_setting('cc.cx_push_token'),'ios',false,'SPAIN','ES','es',
    ARRAY['general','cyclocross'],ARRAY[]::text[],ARRAY[]::text[],ARRAY[]::text[],NULL);
  IF NOT EXISTS(SELECT 1 FROM public.push_cx_race_subscriptions WHERE "subscriptionId"=current_setting('cc.cx_push_subscription')) THEN
    RAISE EXCEPTION 'NULL borra el seguimiento CX'; END IF;
  PERFORM public.set_push_subscription_v4(current_setting('cc.cx_push_token'),'ios',false,'SPAIN','ES','es',
    ARRAY['general','cyclocross'],ARRAY[]::text[],ARRAY[]::text[],ARRAY[]::text[],ARRAY[]::text[]);
  IF EXISTS(SELECT 1 FROM public.push_cx_race_subscriptions WHERE "subscriptionId"=current_setting('cc.cx_push_subscription')) THEN
    RAISE EXCEPTION '[] no borra el seguimiento CX'; END IF;
  IF has_table_privilege('anon','public.push_cx_race_subscriptions','SELECT')
    OR has_table_privilege('cc_results_worker','public.push_cx_race_subscriptions','SELECT')
    OR has_column_privilege('anon','public.scheduled_push_notifications','cxRaceId','SELECT,INSERT,UPDATE') THEN
    RAISE EXCEPTION 'Se exponen suscripciones o cola privada'; END IF;
  IF NOT has_column_privilege('service_role','public.scheduled_push_notifications','cxRaceId','SELECT,INSERT,UPDATE') THEN
    RAISE EXCEPTION 'El emisor no puede resolver el destino CX'; END IF;
  PERFORM set_config('request.jwt.claim.sub',current_setting('cc.cx_push_admin'),true);
  PERFORM set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',current_setting('cc.cx_push_admin'))::text,true);
END $$;
SET LOCAL ROLE authenticated;
DO $$
DECLARE notification_id public.scheduled_push_notifications.id%TYPE; rejected boolean := false;
BEGIN
  IF NOT private.is_admin() THEN RAISE EXCEPTION 'Falta identidad administradora'; END IF;
  INSERT INTO public.scheduled_push_notifications(title,category,"cxRaceId","deepLink","scheduledAt",status)
    VALUES('Prueba CX push','cyclocross',current_setting('cc.cx_push_race'),'cxRace/'||current_setting('cc.cx_push_race'),now(),'cancelled')
    RETURNING id INTO notification_id;
  PERFORM set_config('cc.cx_push_notification',notification_id::text,true);
  INSERT INTO public.push_notifications(title,category,"cxRaceId","recipientCount")
    VALUES('Prueba CX push','cyclocross',current_setting('cc.cx_push_race'),0);
  BEGIN UPDATE public.scheduled_push_notifications SET category='general' WHERE id=notification_id;
  EXCEPTION WHEN check_violation THEN rejected:=true; END;
  IF NOT rejected THEN RAISE EXCEPTION 'Se admite categoría general con destino CX'; END IF;
  rejected:=false;
  BEGIN UPDATE public.scheduled_push_notifications SET "raceId"='carretera' WHERE id=notification_id;
  EXCEPTION WHEN check_violation THEN rejected:=true; END;
  IF NOT rejected THEN RAISE EXCEPTION 'Se admite un ID de carretera en el aviso CX'; END IF;
  rejected:=false;
  BEGIN INSERT INTO public.push_notifications(title,category,"cxRaceId","raceDayId","recipientCount")
    VALUES('Prueba mixta','cyclocross',current_setting('cc.cx_push_race'),'jornada',0);
  EXCEPTION WHEN check_violation THEN rejected:=true; END;
  IF NOT rejected THEN RAISE EXCEPTION 'Se admite una jornada de carretera en historial CX'; END IF;
  DELETE FROM public.cx_races WHERE id=current_setting('cc.cx_push_race');
  IF (SELECT "cxRaceId" FROM public.scheduled_push_notifications WHERE id=notification_id) IS NOT NULL THEN
    RAISE EXCEPTION 'El borrado CX deja una referencia inválida'; END IF;
END $$;
RESET ROLE;
ROLLBACK;
SELECT 'CX push: categoría, RPC, destinos exclusivos, privacidad y borrado comprobados con rollback; sin envíos' AS result;
