-- ─────────────────────────────────────────────────────────────────
--  20260918120537_road_results_push_on_first_save.sql
--
--  Carretera: el aviso de «resultados disponibles» deja de programarse
--  por reloj (T+30 min de estimatedFinishTimeUtc) y pasa a dispararse
--  en el momento en que se guarda por primera vez la clasificación de
--  la jornada.
--
--  Antes:
--    auto_dispatch_premium_pushes() (pg_cron */10) creaba dos filas
--    pendientes (es/en) para cada race_day con estimatedFinishTimeUtc
--    en las próximas 48 h, programadas a meta + 30 min, aunque no
--    hubiera resultados.
--
--  Ahora:
--    · Se retira la rama `results` de auto_dispatch_premium_pushes()
--      (migración 20260918120552); esa función sigue programando
--      race_start y tv_start.
--    · Un trigger sobre race_uci_stages detecta la primera vez que una
--      clasificación de etapa/jornada pasa de rowCount 0 a >0 (alta del
--      volcado automático, edición del panel o PDF) y crea las dos
--      notificaciones (es/en) con scheduledAt = now().
--    · El trigger invoca además process_scheduled_push_notifications()
--      para que el envío no espere al siguiente tick de 5 minutos.
--
--  Idempotencia: se conserva push_auto_dispatch con eventKey
--  'results-<raceDayId>-<lang>' — una sola notificación por jornada.
--  Las programaciones de resultados por reloj que aún estén pendientes
--  se cancelan en la migración 20260918120552 y liberan su eventKey.
--
--  Alcance: solo carretera (race_uci_stages). El ciclocross conserva su
--  propio dispatcher. No se notifican cargas de jornadas antiguas: el
--  trigger exige que dateKey esté entre ayer y mañana (Europe/Madrid).
-- ─────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION private.trg_road_results_push()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_day            public.race_days;
  v_race           public.races;
  v_day_id         text;
  v_lang           text;
  v_event_key      text;
  v_title          text;
  v_subtitle       text;
  v_stage_label_es text;
  v_stage_label_en text;
  v_route_es       text;
  v_route_en       text;
  v_start_loc      text;
  v_finish_loc     text;
  v_start_loc_en   text;
  v_finish_loc_en  text;
  v_new_id         text;
BEGIN
  -- Solo la primera vez que una clasificación visible pasa de 0 a >0.
  IF COALESCE(NEW."rowCount", 0) <= 0 THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND COALESCE(OLD."rowCount", 0) > 0 THEN RETURN NEW; END IF;

  BEGIN
    SELECT * INTO v_race FROM public.races WHERE id = NEW."raceId";
    IF NOT FOUND OR COALESCE(v_race."isCancelled", false) THEN RETURN NEW; END IF;

    -- Resolución de la jornada: enlace directo, por número de etapa o,
    -- para clasificaciones finales / un día, la última jornada válida.
    v_day_id := NEW."raceDayId";
    IF v_day_id IS NULL AND NEW."stageNumber" IS NOT NULL THEN
      SELECT id INTO v_day_id FROM public.race_days
      WHERE "raceId" = NEW."raceId" AND "stageNumber" = NEW."stageNumber"
      ORDER BY "neutralStartTimeUtc" ASC NULLS LAST, id ASC LIMIT 1;
    END IF;
    IF v_day_id IS NULL THEN
      SELECT id INTO v_day_id FROM public.race_days
      WHERE "raceId" = NEW."raceId" AND NOT "isRestDay" AND NOT "isCancelledDay"
      ORDER BY "dateKey" DESC, "neutralStartTimeUtc" DESC NULLS LAST, id DESC LIMIT 1;
    END IF;
    IF v_day_id IS NULL THEN RETURN NEW; END IF;

    SELECT * INTO v_day FROM public.race_days WHERE id = v_day_id;
    IF NOT FOUND OR v_day."isRestDay" OR v_day."isCancelledDay" THEN RETURN NEW; END IF;

    -- Solo jornadas recientes: una recarga histórica no debe notificar.
    IF v_day."dateKey" IS NULL
       OR v_day."dateKey" < to_char((now() AT TIME ZONE 'Europe/Madrid') - interval '1 day', 'YYYY-MM-DD')
       OR v_day."dateKey" > to_char((now() AT TIME ZONE 'Europe/Madrid') + interval '1 day', 'YYYY-MM-DD') THEN
      RETURN NEW;
    END IF;

    -- Una sola notificación por jornada.
    IF EXISTS (SELECT 1 FROM public.push_auto_dispatch pad
               WHERE pad.category = 'results'
                 AND pad."eventKey" IN ('results-' || v_day_id || '-es',
                                        'results-' || v_day_id || '-en')) THEN
      RETURN NEW;
    END IF;

    v_start_loc     := NULLIF(btrim(v_day."startLocation"), '');
    v_finish_loc    := NULLIF(btrim(v_day."finishLocation"), '');
    v_start_loc_en  := NULLIF(btrim(v_day."startLocationEn"), '');
    v_finish_loc_en := NULLIF(btrim(v_day."finishLocationEn"), '');
    IF v_start_loc IS NOT NULL AND v_finish_loc IS NOT NULL THEN
      v_route_es := v_start_loc || ' → ' || v_finish_loc;
    END IF;
    IF COALESCE(v_start_loc_en, v_start_loc) IS NOT NULL
       AND COALESCE(v_finish_loc_en, v_finish_loc) IS NOT NULL THEN
      v_route_en := COALESCE(v_start_loc_en, v_start_loc) || ' → ' ||
                    COALESCE(v_finish_loc_en, v_finish_loc);
    END IF;
    v_stage_label_es := CASE WHEN v_day."stageNumber" IS NOT NULL
                              THEN ' · Etapa ' || v_day."stageNumber" ELSE '' END;
    v_stage_label_en := CASE WHEN v_day."stageNumber" IS NOT NULL
                              THEN ' · Stage ' || v_day."stageNumber" ELSE '' END;

    FOREACH v_lang IN ARRAY ARRAY['es', 'en'] LOOP
      v_event_key := 'results-' || v_day_id || '-' || v_lang;
      IF v_lang = 'es' THEN
        v_title := v_race.name || v_stage_label_es;
        v_subtitle := 'Resultados disponibles' || COALESCE(' · ' || v_route_es, '');
      ELSE
        v_title := COALESCE(v_race."nameEn", v_race.name) || v_stage_label_en;
        v_subtitle := 'Results available' || COALESCE(' · ' || v_route_en, '');
      END IF;

      v_new_id := gen_random_uuid()::text;
      INSERT INTO public.scheduled_push_notifications (
        id, title, subtitle, "deepLink", "raceId", "raceDayId",
        category, "targetLanguages", "scheduledAt", status, "createdBy"
      ) VALUES (
        v_new_id, v_title, v_subtitle, 'stage/' || v_day_id,
        v_race.id, v_day_id, 'results', ARRAY[v_lang], now(), 'pending', 'auto_dispatch'
      );
      INSERT INTO public.push_auto_dispatch (
        "eventKey", category, "scheduledNotificationId", "sourceTimeUtc", "raceId"
      ) VALUES (v_event_key, 'results', v_new_id, now(), v_race.id);
    END LOOP;

    -- Envío inmediato; el procesador reclama de forma atómica y es idempotente.
    BEGIN
      PERFORM public.process_scheduled_push_notifications();
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING '[results-push] no se pudo disparar el procesador: %', SQLERRM;
    END;
  EXCEPTION WHEN OTHERS THEN
    -- Un fallo aquí nunca debe abortar la ingesta de resultados.
    RAISE WARNING '[results-push] %', SQLERRM;
  END;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.trg_road_results_push() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS race_uci_stages_results_push ON public.race_uci_stages;
CREATE TRIGGER race_uci_stages_results_push
  AFTER INSERT OR UPDATE OF "rowCount" ON public.race_uci_stages
  FOR EACH ROW
  WHEN (
    COALESCE(NEW."rowCount", 0) > 0
    AND NEW."classKind" IN ('stage', 'gc')
    AND NEW.scope = 'stage'
  )
  EXECUTE FUNCTION private.trg_road_results_push();

COMMENT ON FUNCTION private.trg_road_results_push() IS
  'Carretera: al guardarse por primera vez la clasificación stage/gc de la jornada '
  '(rowCount 0→>0), programa las dos notificaciones results (es/en) a now() e invoca '
  'el procesador de send-push. Idempotente por jornada vía push_auto_dispatch.';
