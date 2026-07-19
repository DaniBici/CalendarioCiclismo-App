-- ─────────────────────────────────────────────────────────────────
--  053_push_auto_dispatch_enriched_i18n.sql
--
--  Enriquece los textos de las notificaciones Premium auto-generadas
--  (race_start, tv_start, results) y las emite en ES y EN.
--
--  Antes (migración 051): un único insert por evento con textos
--  genéricos en español.
--    title:    "{race.name}"
--    subtitle: "Arranca la jornada en 30 minutos"
--
--  Después (esta migración): dos inserts por evento, uno con
--  `targetLanguages=['es']` y otro con `['en']`. Cada uno usa textos
--  enriquecidos que incluyen:
--    - nº de etapa cuando rd.stageNumber NOT NULL
--    - startLocation → finishLocation cuando ambos NOT NULL
--    - distanceKm en race_start cuando NOT NULL
--    - canal del primer broadcast visible en tv_start
--
--  Esquema de eventKey:
--    race_start: "racestart-{rd.id}-{lang}"
--    results:    "results-{rd.id}-{lang}"
--    tv_start:   "tvstart-{rd.id}-{group}-{lang}"
--
--  Los eventKeys antiguos (sin sufijo de idioma) y los recién
--  añadidos coexisten sin colisión: son ortogonales por sufijo.
-- ─────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.auto_dispatch_premium_pushes(window_hours INTEGER DEFAULT 48)
RETURNS TABLE(action TEXT, event_key TEXT, category TEXT, scheduled_at TIMESTAMPTZ)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_now           TIMESTAMPTZ := NOW();
  v_window_end    TIMESTAMPTZ := NOW() + (window_hours::TEXT || ' hours')::INTERVAL;
  rec             RECORD;
  v_event_key     TEXT;
  v_scheduled_for TIMESTAMPTZ;
  v_existing_id   TEXT;
  v_existing_src  TIMESTAMPTZ;
  v_new_id        TEXT;
  v_lang          TEXT;
  v_title         TEXT;
  v_subtitle      TEXT;
  v_route_es      TEXT;
  v_route_en      TEXT;
  v_stage_label_es TEXT;
  v_stage_label_en TEXT;
  v_distance_txt  TEXT;
BEGIN
  -- ── 1. race_start · T-30 min de neutralStartTimeUtc ────────────
  FOR rec IN
    SELECT rd.id AS race_day_id, r.id AS race_id,
           rd."neutralStartTimeUtc" AS source_time,
           r.name AS race_name, r."nameEn" AS race_name_en,
           rd."stageNumber" AS stage_number,
           rd."startLocation" AS start_loc, rd."finishLocation" AS finish_loc,
           rd."startLocationEn" AS start_loc_en, rd."finishLocationEn" AS finish_loc_en,
           rd."distanceKm" AS distance_km
    FROM race_days rd JOIN races r ON r.id = rd."raceId"
    WHERE rd."neutralStartTimeUtc" IS NOT NULL
      AND rd."isRestDay" = false AND rd."isCancelledDay" = false
      AND r."isCancelled" = false
      AND rd."neutralStartTimeUtc" BETWEEN v_now AND v_window_end
  LOOP
    v_scheduled_for := rec.source_time - INTERVAL '30 minutes';
    IF v_scheduled_for <= v_now THEN CONTINUE; END IF;

    -- Construye el sufijo de recorrido y distancia (compartido)
    IF rec.start_loc IS NOT NULL AND rec.finish_loc IS NOT NULL THEN
      v_route_es := rec.start_loc || ' → ' || rec.finish_loc;
    ELSE
      v_route_es := NULL;
    END IF;
    IF COALESCE(rec.start_loc_en, rec.start_loc) IS NOT NULL
       AND COALESCE(rec.finish_loc_en, rec.finish_loc) IS NOT NULL THEN
      v_route_en := COALESCE(rec.start_loc_en, rec.start_loc) || ' → ' ||
                    COALESCE(rec.finish_loc_en, rec.finish_loc);
    ELSE
      v_route_en := NULL;
    END IF;
    IF rec.distance_km IS NOT NULL THEN
      v_distance_txt := round(rec.distance_km)::TEXT || ' km';
    ELSE
      v_distance_txt := NULL;
    END IF;
    v_stage_label_es := CASE WHEN rec.stage_number IS NOT NULL
                              THEN ' · Etapa ' || rec.stage_number ELSE '' END;
    v_stage_label_en := CASE WHEN rec.stage_number IS NOT NULL
                              THEN ' · Stage ' || rec.stage_number ELSE '' END;

    FOREACH v_lang IN ARRAY ARRAY['es', 'en'] LOOP
      v_event_key := 'racestart-' || rec.race_day_id || '-' || v_lang;

      IF v_lang = 'es' THEN
        v_title := rec.race_name || v_stage_label_es;
        v_subtitle := 'Salen en 30 min'
          || COALESCE(' · ' || v_route_es, '')
          || COALESCE(' · ' || v_distance_txt, '');
      ELSE
        v_title := COALESCE(rec.race_name_en, rec.race_name) || v_stage_label_en;
        v_subtitle := 'Starts in 30 min'
          || COALESCE(' · ' || v_route_en, '')
          || COALESCE(' · ' || v_distance_txt, '');
      END IF;

      SELECT pad."scheduledNotificationId", pad."sourceTimeUtc" INTO v_existing_id, v_existing_src
        FROM push_auto_dispatch pad
        WHERE pad."eventKey" = v_event_key AND pad.category = 'race_start';
      IF v_existing_id IS NULL THEN
        v_new_id := gen_random_uuid()::TEXT;
        INSERT INTO scheduled_push_notifications (
          id, title, subtitle, "deepLink", "raceId", "raceDayId",
          category, "targetLanguages", "scheduledAt", status, "createdBy"
        ) VALUES (
          v_new_id, v_title, v_subtitle, 'stage/' || rec.race_day_id,
          rec.race_id, rec.race_day_id, 'race_start',
          ARRAY[v_lang], v_scheduled_for, 'pending', 'auto_dispatch'
        );
        INSERT INTO push_auto_dispatch (
          "eventKey", category, "scheduledNotificationId", "sourceTimeUtc", "raceId"
        ) VALUES (v_event_key, 'race_start', v_new_id, rec.source_time, rec.race_id);
        action := 'inserted'; event_key := v_event_key; category := 'race_start'; scheduled_at := v_scheduled_for;
        RETURN NEXT;
      ELSIF v_existing_src IS DISTINCT FROM rec.source_time THEN
        UPDATE scheduled_push_notifications
          SET "scheduledAt" = v_scheduled_for, title = v_title, subtitle = v_subtitle
          WHERE id = v_existing_id AND status = 'pending';
        UPDATE push_auto_dispatch SET "sourceTimeUtc" = rec.source_time, "updatedAt" = v_now
          WHERE "eventKey" = v_event_key AND category = 'race_start';
        action := 'rescheduled'; event_key := v_event_key; category := 'race_start'; scheduled_at := v_scheduled_for;
        RETURN NEXT;
      END IF;
    END LOOP;
  END LOOP;

  -- ── 2. results · T+30 min de estimatedFinishTimeUtc ────────────
  FOR rec IN
    SELECT rd.id AS race_day_id, r.id AS race_id,
           rd."estimatedFinishTimeUtc" AS source_time,
           r.name AS race_name, r."nameEn" AS race_name_en,
           rd."stageNumber" AS stage_number,
           rd."startLocation" AS start_loc, rd."finishLocation" AS finish_loc,
           rd."startLocationEn" AS start_loc_en, rd."finishLocationEn" AS finish_loc_en
    FROM race_days rd JOIN races r ON r.id = rd."raceId"
    WHERE rd."estimatedFinishTimeUtc" IS NOT NULL
      AND rd."isRestDay" = false AND rd."isCancelledDay" = false
      AND r."isCancelled" = false
      AND rd."estimatedFinishTimeUtc" BETWEEN v_now AND v_window_end
  LOOP
    v_scheduled_for := rec.source_time + INTERVAL '30 minutes';
    IF v_scheduled_for <= v_now THEN CONTINUE; END IF;

    IF rec.start_loc IS NOT NULL AND rec.finish_loc IS NOT NULL THEN
      v_route_es := rec.start_loc || ' → ' || rec.finish_loc;
    ELSE
      v_route_es := NULL;
    END IF;
    IF COALESCE(rec.start_loc_en, rec.start_loc) IS NOT NULL
       AND COALESCE(rec.finish_loc_en, rec.finish_loc) IS NOT NULL THEN
      v_route_en := COALESCE(rec.start_loc_en, rec.start_loc) || ' → ' ||
                    COALESCE(rec.finish_loc_en, rec.finish_loc);
    ELSE
      v_route_en := NULL;
    END IF;
    v_stage_label_es := CASE WHEN rec.stage_number IS NOT NULL
                              THEN ' · Etapa ' || rec.stage_number ELSE '' END;
    v_stage_label_en := CASE WHEN rec.stage_number IS NOT NULL
                              THEN ' · Stage ' || rec.stage_number ELSE '' END;

    FOREACH v_lang IN ARRAY ARRAY['es', 'en'] LOOP
      v_event_key := 'results-' || rec.race_day_id || '-' || v_lang;

      IF v_lang = 'es' THEN
        v_title := rec.race_name || v_stage_label_es;
        v_subtitle := 'Resultados disponibles'
          || COALESCE(' · ' || v_route_es, '');
      ELSE
        v_title := COALESCE(rec.race_name_en, rec.race_name) || v_stage_label_en;
        v_subtitle := 'Results available'
          || COALESCE(' · ' || v_route_en, '');
      END IF;

      SELECT pad."scheduledNotificationId", pad."sourceTimeUtc" INTO v_existing_id, v_existing_src
        FROM push_auto_dispatch pad
        WHERE pad."eventKey" = v_event_key AND pad.category = 'results';
      IF v_existing_id IS NULL THEN
        v_new_id := gen_random_uuid()::TEXT;
        INSERT INTO scheduled_push_notifications (
          id, title, subtitle, "deepLink", "raceId", "raceDayId",
          category, "targetLanguages", "scheduledAt", status, "createdBy"
        ) VALUES (
          v_new_id, v_title, v_subtitle, 'stage/' || rec.race_day_id,
          rec.race_id, rec.race_day_id, 'results',
          ARRAY[v_lang], v_scheduled_for, 'pending', 'auto_dispatch'
        );
        INSERT INTO push_auto_dispatch (
          "eventKey", category, "scheduledNotificationId", "sourceTimeUtc", "raceId"
        ) VALUES (v_event_key, 'results', v_new_id, rec.source_time, rec.race_id);
        action := 'inserted'; event_key := v_event_key; category := 'results'; scheduled_at := v_scheduled_for;
        RETURN NEXT;
      ELSIF v_existing_src IS DISTINCT FROM rec.source_time THEN
        UPDATE scheduled_push_notifications
          SET "scheduledAt" = v_scheduled_for, title = v_title, subtitle = v_subtitle
          WHERE id = v_existing_id AND status = 'pending';
        UPDATE push_auto_dispatch SET "sourceTimeUtc" = rec.source_time, "updatedAt" = v_now
          WHERE "eventKey" = v_event_key AND category = 'results';
        action := 'rescheduled'; event_key := v_event_key; category := 'results'; scheduled_at := v_scheduled_for;
        RETURN NEXT;
      END IF;
    END LOOP;
  END LOOP;

  -- ── 3. tv_start · 1 por (jornada, grupo fino, idioma) ──────────
  -- Reglas de visibilidad (paridad con js/shared.js filterBroadcastsByRegion):
  --   - Todos los grupos: ALL.
  --   - Europeos (excepto UK_IE): + EUROPA.
  --   - UK_IE: NO recibe EUROPA.
  --   - Resto: solo su propio grupo + ALL.
  --
  -- Skip de redundancia con race_start (migración 051):
  -- si el primer broadcast visible arranca dentro de los 30 min
  -- siguientes al neutralStartTimeUtc, se omite (race_start ya cubre).
  --
  -- Extra (esta migración): subtitle incluye el canal del broadcast
  -- que define el MIN(startTimeUtc) visible para ese grupo.
  FOR rec IN
    SELECT b."raceDayId" AS race_day_id, r.id AS race_id,
           r.name AS race_name, r."nameEn" AS race_name_en,
           rd."stageNumber" AS stage_number,
           rd."startLocation" AS start_loc, rd."finishLocation" AS finish_loc,
           rd."startLocationEn" AS start_loc_en, rd."finishLocationEn" AS finish_loc_en,
           gp.user_group,
           MIN(b."startTimeUtc") FILTER (WHERE b.country = ANY(gp.visible_groups)) AS source_time,
           rd."neutralStartTimeUtc" AS neutral_start,
           -- Channel del broadcast que coincide con el MIN
           (SELECT b2.channel
              FROM broadcasts b2
              WHERE b2."raceDayId" = b."raceDayId"
                AND b2.country = ANY(gp.visible_groups)
                AND b2."startTimeUtc" IS NOT NULL
              ORDER BY b2."startTimeUtc" ASC
              LIMIT 1) AS min_channel
    FROM broadcasts b
    JOIN race_days rd ON rd.id = b."raceDayId"
    JOIN races r ON r.id = rd."raceId"
    CROSS JOIN (VALUES
      ('ES',       ARRAY['ALL','EUROPA','ES']::TEXT[]),
      ('PT',       ARRAY['ALL','EUROPA','PT']::TEXT[]),
      ('FR',       ARRAY['ALL','EUROPA','FR']::TEXT[]),
      ('BE',       ARRAY['ALL','EUROPA','BE']::TEXT[]),
      ('NL',       ARRAY['ALL','EUROPA','NL']::TEXT[]),
      ('IT',       ARRAY['ALL','EUROPA','IT']::TEXT[]),
      ('DE_AT_CH', ARRAY['ALL','EUROPA','DE_AT_CH']::TEXT[]),
      ('UK_IE',    ARRAY['ALL','UK_IE']::TEXT[]),
      ('SCANDI',   ARRAY['ALL','EUROPA','SCANDI']::TEXT[]),
      ('EE',       ARRAY['ALL','EUROPA','EE']::TEXT[]),
      ('NORTEAM',  ARRAY['ALL','NORTEAM']::TEXT[]),
      ('LATAM',    ARRAY['ALL','LATAM']::TEXT[]),
      ('ASIAPAC',  ARRAY['ALL','ASIAPAC']::TEXT[]),
      ('MENA',     ARRAY['ALL','MENA']::TEXT[]),
      ('AFRICA',   ARRAY['ALL','AFRICA']::TEXT[])
    ) AS gp(user_group, visible_groups)
    WHERE b."startTimeUtc" IS NOT NULL
      AND rd."isRestDay" = false AND rd."isCancelledDay" = false
      AND r."isCancelled" = false
      AND b.country = ANY(gp.visible_groups)
    GROUP BY b."raceDayId", r.id, r.name, r."nameEn",
             rd."stageNumber", rd."startLocation", rd."finishLocation",
             rd."startLocationEn", rd."finishLocationEn",
             gp.user_group, gp.visible_groups, rd."neutralStartTimeUtc"
    HAVING MIN(b."startTimeUtc") FILTER (WHERE b.country = ANY(gp.visible_groups))
           BETWEEN v_now AND v_window_end
  LOOP
    -- Skip de redundancia con race_start (cobertura íntegra)
    IF rec.neutral_start IS NOT NULL
       AND rec.source_time - rec.neutral_start <= INTERVAL '30 minutes' THEN
      -- Cancelar cualquier tv_start pendiente para los 2 idiomas
      FOREACH v_lang IN ARRAY ARRAY['es', 'en'] LOOP
        v_event_key := 'tvstart-' || rec.race_day_id || '-' || lower(rec.user_group) || '-' || v_lang;
        SELECT pad."scheduledNotificationId" INTO v_existing_id
          FROM push_auto_dispatch pad
          WHERE pad."eventKey" = v_event_key AND pad.category = 'tv_start';
        IF v_existing_id IS NOT NULL THEN
          UPDATE scheduled_push_notifications SET status = 'cancelled'
            WHERE id = v_existing_id AND status = 'pending';
          DELETE FROM push_auto_dispatch
            WHERE "eventKey" = v_event_key AND category = 'tv_start';
          action := 'cancelled'; event_key := v_event_key; category := 'tv_start'; scheduled_at := NULL;
          RETURN NEXT;
        END IF;
      END LOOP;
      CONTINUE;
    END IF;

    v_scheduled_for := rec.source_time - INTERVAL '5 minutes';
    IF v_scheduled_for <= v_now THEN CONTINUE; END IF;

    IF rec.start_loc IS NOT NULL AND rec.finish_loc IS NOT NULL THEN
      v_route_es := rec.start_loc || ' → ' || rec.finish_loc;
    ELSE
      v_route_es := NULL;
    END IF;
    IF COALESCE(rec.start_loc_en, rec.start_loc) IS NOT NULL
       AND COALESCE(rec.finish_loc_en, rec.finish_loc) IS NOT NULL THEN
      v_route_en := COALESCE(rec.start_loc_en, rec.start_loc) || ' → ' ||
                    COALESCE(rec.finish_loc_en, rec.finish_loc);
    ELSE
      v_route_en := NULL;
    END IF;
    v_stage_label_es := CASE WHEN rec.stage_number IS NOT NULL
                              THEN ' · Etapa ' || rec.stage_number ELSE '' END;
    v_stage_label_en := CASE WHEN rec.stage_number IS NOT NULL
                              THEN ' · Stage ' || rec.stage_number ELSE '' END;

    FOREACH v_lang IN ARRAY ARRAY['es', 'en'] LOOP
      v_event_key := 'tvstart-' || rec.race_day_id || '-' || lower(rec.user_group) || '-' || v_lang;

      IF v_lang = 'es' THEN
        v_title := rec.race_name || v_stage_label_es;
        v_subtitle := COALESCE('Empieza la emisión en ' || rec.min_channel,
                               'Empieza la emisión por televisión')
          || COALESCE(' · ' || v_route_es, '');
      ELSE
        v_title := COALESCE(rec.race_name_en, rec.race_name) || v_stage_label_en;
        v_subtitle := COALESCE('Broadcast starts on ' || rec.min_channel,
                               'Broadcast starting')
          || COALESCE(' · ' || v_route_en, '');
      END IF;

      SELECT pad."scheduledNotificationId", pad."sourceTimeUtc" INTO v_existing_id, v_existing_src
        FROM push_auto_dispatch pad WHERE pad."eventKey" = v_event_key AND pad.category = 'tv_start';
      IF v_existing_id IS NULL THEN
        v_new_id := gen_random_uuid()::TEXT;
        INSERT INTO scheduled_push_notifications (
          id, title, subtitle, "deepLink", "raceId", "raceDayId", category,
          "targetCountryGroups", "targetLanguages", "scheduledAt", status, "createdBy"
        ) VALUES (
          v_new_id, v_title, v_subtitle, 'stage/' || rec.race_day_id,
          rec.race_id, rec.race_day_id, 'tv_start',
          ARRAY[rec.user_group], ARRAY[v_lang], v_scheduled_for, 'pending', 'auto_dispatch'
        );
        INSERT INTO push_auto_dispatch (
          "eventKey", category, "scheduledNotificationId", "sourceTimeUtc", "raceId"
        ) VALUES (v_event_key, 'tv_start', v_new_id, rec.source_time, rec.race_id);
        action := 'inserted'; event_key := v_event_key; category := 'tv_start'; scheduled_at := v_scheduled_for;
        RETURN NEXT;
      ELSIF v_existing_src IS DISTINCT FROM rec.source_time THEN
        UPDATE scheduled_push_notifications
          SET "scheduledAt" = v_scheduled_for, title = v_title, subtitle = v_subtitle
          WHERE id = v_existing_id AND status = 'pending';
        UPDATE push_auto_dispatch SET "sourceTimeUtc" = rec.source_time, "updatedAt" = v_now
          WHERE "eventKey" = v_event_key AND category = 'tv_start';
        action := 'rescheduled'; event_key := v_event_key; category := 'tv_start'; scheduled_at := v_scheduled_for;
        RETURN NEXT;
      END IF;
    END LOOP;
  END LOOP;

  RETURN;
END;
$$;

COMMENT ON FUNCTION public.auto_dispatch_premium_pushes(INTEGER)
  IS 'Programa notificaciones Premium en ES y EN. Por cada evento (race_start, results, tv_start×grupo fino) se generan 2 inserts con targetLanguages=[''es''] y [''en'']. Textos incluyen stageNumber, recorrido start→finish, distanceKm en race_start y canal del broadcast en tv_start. Idempotente vía push_auto_dispatch con eventKey sufijado por idioma.';
