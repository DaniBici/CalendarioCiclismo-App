-- ─────────────────────────────────────────────────────────────────
--  046_push_auto_dispatch_race_id.sql
--
--  Actualiza auto_dispatch_premium_pushes() con dos mejoras:
--
--  1. Propaga raceId a scheduled_push_notifications y push_auto_dispatch
--     para que doSend() pueda filtrar por suscripciones de carrera.
--
--  2. Rediseña el bloque tv_start: en lugar de una sola notificación
--     con MIN(startTimeUtc) de TODOS los broadcasts, crea una notificación
--     por región de usuario usando el primer broadcast visible para esa
--     región. Así cada usuario recibe el aviso a la hora correcta para
--     su contexto (no al horario de un canal que no puede ver).
--
--  Mapa de visibilidad (igual que filterBroadcastsByRegion en apps/web):
--    SPAIN    → ALL, EUROPA, ES
--    EUROPE   → ALL, EUROPA, ES, PT, FR, BE, NL, IT, DE_AT_CH, UK_IE, SCANDI, EE
--    AMERICAS → ALL, NORTEAM, LATAM
--    ASIA     → ALL, ASIAPAC, MENA
--    AFRICA   → ALL, AFRICA, MENA
--
--  Idempotencia: los nuevos eventKeys tienen sufijo de región
--  ('tvstart-{raceDayId}-spain', 'tvstart-{raceDayId}-europe', …),
--  distintos de los eventKeys antiguos ('tvstart-{raceDayId}') que
--  se mantendrán activos hasta que sean procesados.
--
--  Cambios de horario: si MIN(startTimeUtc) de una región cambia
--  (canal añadido, horario corregido), el mecanismo existente
--  (ELSIF v_existing_src IS DISTINCT FROM rec.source_time) reprograma
--  la notificación pendiente automáticamente.
--
--  Si una región no tiene broadcasts, no se genera notificación para
--  esa región — correcto, no hay canal que avisar.
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
BEGIN
  -- ╭────────────────────────────────────────────────────────────╮
  -- │ 1. race_start  ·  T-30 min de neutralStartTimeUtc           │
  -- ╰────────────────────────────────────────────────────────────╯
  FOR rec IN
    SELECT rd.id              AS race_day_id,
           r.id               AS race_id,
           rd."neutralStartTimeUtc" AS source_time,
           r.name             AS race_name
    FROM race_days rd
    JOIN races r ON r.id = rd."raceId"
    WHERE rd."neutralStartTimeUtc" IS NOT NULL
      AND rd."isRestDay" = false
      AND rd."isCancelledDay" = false
      AND r."isCancelled" = false
      AND rd."neutralStartTimeUtc" BETWEEN v_now AND v_window_end
  LOOP
    v_event_key     := 'racestart-' || rec.race_day_id;
    v_scheduled_for := rec.source_time - INTERVAL '30 minutes';
    IF v_scheduled_for <= v_now THEN CONTINUE; END IF;

    SELECT pad."scheduledNotificationId", pad."sourceTimeUtc"
      INTO v_existing_id, v_existing_src
    FROM push_auto_dispatch pad
    WHERE pad."eventKey" = v_event_key AND pad.category = 'race_start';

    IF v_existing_id IS NULL THEN
      v_new_id := gen_random_uuid()::TEXT;
      INSERT INTO scheduled_push_notifications (
        id, title, subtitle, "deepLink", "raceId", category, "scheduledAt", status, "createdBy"
      ) VALUES (
        v_new_id,
        rec.race_name,
        'Arranca la jornada en 30 minutos',
        'stage/' || rec.race_day_id,
        rec.race_id,
        'race_start',
        v_scheduled_for,
        'pending',
        'auto_dispatch'
      );
      INSERT INTO push_auto_dispatch ("eventKey", category, "scheduledNotificationId", "sourceTimeUtc", "raceId")
      VALUES (v_event_key, 'race_start', v_new_id, rec.source_time, rec.race_id);
      action := 'inserted'; event_key := v_event_key; category := 'race_start'; scheduled_at := v_scheduled_for;
      RETURN NEXT;
    ELSIF v_existing_src IS DISTINCT FROM rec.source_time THEN
      UPDATE scheduled_push_notifications
        SET "scheduledAt" = v_scheduled_for
      WHERE id = v_existing_id AND status = 'pending';
      UPDATE push_auto_dispatch
        SET "sourceTimeUtc" = rec.source_time, "updatedAt" = v_now
      WHERE "eventKey" = v_event_key AND category = 'race_start';
      action := 'rescheduled'; event_key := v_event_key; category := 'race_start'; scheduled_at := v_scheduled_for;
      RETURN NEXT;
    END IF;
  END LOOP;

  -- ╭────────────────────────────────────────────────────────────╮
  -- │ 2. results  ·  T+30 min de estimatedFinishTimeUtc           │
  -- ╰────────────────────────────────────────────────────────────╯
  FOR rec IN
    SELECT rd.id              AS race_day_id,
           r.id               AS race_id,
           rd."estimatedFinishTimeUtc" AS source_time,
           r.name             AS race_name
    FROM race_days rd
    JOIN races r ON r.id = rd."raceId"
    WHERE rd."estimatedFinishTimeUtc" IS NOT NULL
      AND rd."isRestDay" = false
      AND rd."isCancelledDay" = false
      AND r."isCancelled" = false
      AND rd."estimatedFinishTimeUtc" BETWEEN v_now AND v_window_end
  LOOP
    v_event_key     := 'results-' || rec.race_day_id;
    v_scheduled_for := rec.source_time + INTERVAL '30 minutes';
    IF v_scheduled_for <= v_now THEN CONTINUE; END IF;

    SELECT pad."scheduledNotificationId", pad."sourceTimeUtc"
      INTO v_existing_id, v_existing_src
    FROM push_auto_dispatch pad
    WHERE pad."eventKey" = v_event_key AND pad.category = 'results';

    IF v_existing_id IS NULL THEN
      v_new_id := gen_random_uuid()::TEXT;
      INSERT INTO scheduled_push_notifications (
        id, title, subtitle, "deepLink", "raceId", category, "scheduledAt", status, "createdBy"
      ) VALUES (
        v_new_id,
        rec.race_name,
        'Ya disponibles los resultados de la jornada',
        'stage/' || rec.race_day_id,
        rec.race_id,
        'results',
        v_scheduled_for,
        'pending',
        'auto_dispatch'
      );
      INSERT INTO push_auto_dispatch ("eventKey", category, "scheduledNotificationId", "sourceTimeUtc", "raceId")
      VALUES (v_event_key, 'results', v_new_id, rec.source_time, rec.race_id);
      action := 'inserted'; event_key := v_event_key; category := 'results'; scheduled_at := v_scheduled_for;
      RETURN NEXT;
    ELSIF v_existing_src IS DISTINCT FROM rec.source_time THEN
      UPDATE scheduled_push_notifications
        SET "scheduledAt" = v_scheduled_for
      WHERE id = v_existing_id AND status = 'pending';
      UPDATE push_auto_dispatch
        SET "sourceTimeUtc" = rec.source_time, "updatedAt" = v_now
      WHERE "eventKey" = v_event_key AND category = 'results';
      action := 'rescheduled'; event_key := v_event_key; category := 'results'; scheduled_at := v_scheduled_for;
      RETURN NEXT;
    END IF;
  END LOOP;

  -- ╭────────────────────────────────────────────────────────────╮
  -- │ 3. tv_start · T-5 min del primer broadcast POR REGIÓN       │
  -- │                                                              │
  -- │  Una notificación por par (jornada, región_usuario) usando   │
  -- │  el primer broadcast visible para esa región. Cada usuario   │
  -- │  recibe el aviso al horario del canal que puede ver.         │
  -- │                                                              │
  -- │  targetRegions=[región] en la notificación → doSend solo     │
  -- │  entrega a suscriptores de esa región.                       │
  -- ╰────────────────────────────────────────────────────────────╯
  FOR rec IN
    SELECT
      b."raceDayId"                                                        AS race_day_id,
      r.id                                                                 AS race_id,
      r.name                                                               AS race_name,
      rg.user_region,
      MIN(b."startTimeUtc") FILTER (WHERE b.country = ANY(rg.visible_groups)) AS source_time
    FROM broadcasts b
    JOIN race_days rd ON rd.id = b."raceDayId"
    JOIN races r ON r.id = rd."raceId"
    CROSS JOIN (VALUES
      ('SPAIN',    ARRAY['ALL','EUROPA','ES']::TEXT[]),
      ('EUROPE',   ARRAY['ALL','EUROPA','ES','PT','FR','BE','NL','IT','DE_AT_CH','UK_IE','SCANDI','EE']::TEXT[]),
      ('AMERICAS', ARRAY['ALL','NORTEAM','LATAM']::TEXT[]),
      ('ASIA',     ARRAY['ALL','ASIAPAC','MENA']::TEXT[]),
      ('AFRICA',   ARRAY['ALL','AFRICA','MENA']::TEXT[])
    ) AS rg(user_region, visible_groups)
    WHERE b."startTimeUtc" IS NOT NULL
      AND rd."isRestDay" = false
      AND rd."isCancelledDay" = false
      AND r."isCancelled" = false
      AND b.country = ANY(rg.visible_groups)
    GROUP BY b."raceDayId", r.id, r.name, rg.user_region, rg.visible_groups
    HAVING MIN(b."startTimeUtc") FILTER (WHERE b.country = ANY(rg.visible_groups))
           BETWEEN v_now AND v_window_end
  LOOP
    -- Sufijo de región en el eventKey para idempotencia por par (jornada, región)
    v_event_key     := 'tvstart-' || rec.race_day_id || '-' || lower(rec.user_region);
    v_scheduled_for := rec.source_time - INTERVAL '5 minutes';
    IF v_scheduled_for <= v_now THEN CONTINUE; END IF;

    SELECT pad."scheduledNotificationId", pad."sourceTimeUtc"
      INTO v_existing_id, v_existing_src
    FROM push_auto_dispatch pad
    WHERE pad."eventKey" = v_event_key AND pad.category = 'tv_start';

    IF v_existing_id IS NULL THEN
      v_new_id := gen_random_uuid()::TEXT;
      INSERT INTO scheduled_push_notifications (
        id, title, subtitle, "deepLink", "raceId", category, "targetRegions", "scheduledAt", status, "createdBy"
      ) VALUES (
        v_new_id,
        rec.race_name,
        'Empieza la emisión por televisión',
        'stage/' || rec.race_day_id,
        rec.race_id,
        'tv_start',
        ARRAY[rec.user_region],
        v_scheduled_for,
        'pending',
        'auto_dispatch'
      );
      INSERT INTO push_auto_dispatch ("eventKey", category, "scheduledNotificationId", "sourceTimeUtc", "raceId")
      VALUES (v_event_key, 'tv_start', v_new_id, rec.source_time, rec.race_id);
      action := 'inserted'; event_key := v_event_key; category := 'tv_start'; scheduled_at := v_scheduled_for;
      RETURN NEXT;
    ELSIF v_existing_src IS DISTINCT FROM rec.source_time THEN
      UPDATE scheduled_push_notifications
        SET "scheduledAt" = v_scheduled_for
      WHERE id = v_existing_id AND status = 'pending';
      UPDATE push_auto_dispatch
        SET "sourceTimeUtc" = rec.source_time, "updatedAt" = v_now
      WHERE "eventKey" = v_event_key AND category = 'tv_start';
      action := 'rescheduled'; event_key := v_event_key; category := 'tv_start'; scheduled_at := v_scheduled_for;
      RETURN NEXT;
    END IF;
  END LOOP;

  RETURN;
END;
$$;

COMMENT ON FUNCTION public.auto_dispatch_premium_pushes(INTEGER)
  IS 'Programa notificaciones Premium (race_start/tv_start/results). race_start y results propagan raceId para filtrado por suscripción de carrera. tv_start crea una notificación por región de usuario con el primer broadcast visible para esa región. Idempotente vía push_auto_dispatch. Devuelve un row por cada acción (inserted/rescheduled).';
