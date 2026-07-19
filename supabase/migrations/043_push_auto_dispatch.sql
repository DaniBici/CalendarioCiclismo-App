-- ─────────────────────────────────────────────────────────────────
--  043_push_auto_dispatch.sql
--
--  Disparo automático de notificaciones Premium (complementa Fase 3).
--
--  Hasta esta migración, las notificaciones programadas solo se creaban
--  desde el panel admin a mano. Esta migración añade un cron pg_cron
--  que escanea race_days y broadcasts en las próximas 48 h y crea
--  automáticamente entradas en `scheduled_push_notifications` para los
--  3 momentos Premium:
--
--    - race_start:  T-30 min de race_days.neutralStartTimeUtc
--    - tv_start:    T-5 min  del primer broadcasts.startTimeUtc del día
--    - results:     T+30 min de race_days.estimatedFinishTimeUtc
--
--  La regla "no degradar lo gratis" se cumple sin esfuerzo: los devices
--  free no tienen `race_start`/`tv_start`/`results` en su set de
--  categorías, por lo que el inner join de `doSend` los excluye. Hasta
--  que llegue Premium en Fase 6 estas notificaciones se enviarán a 0
--  destinatarios (visible en `recipientCount` del historial).
--
--  Idempotencia: tabla `push_auto_dispatch` con UNIQUE(eventKey,category)
--  evita duplicados. Si la fuente cambia (ej. neutralStartTimeUtc se
--  desplaza una hora), la función reprograma `scheduledAt` si la
--  notificación aún está pendiente.
--
--  El subtitle se mantiene en español. Cuando Premium soporte
--  notificaciones bilingües habrá que duplicar mensajes por idioma del
--  device — fuera del alcance de Fase 3+.
-- ─────────────────────────────────────────────────────────────────

-- ── Tabla de tracking ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS push_auto_dispatch (
  id                       UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  "eventKey"               TEXT        NOT NULL,
  category                 TEXT        NOT NULL,
  "scheduledNotificationId" TEXT       NOT NULL
                                       REFERENCES scheduled_push_notifications(id) ON DELETE CASCADE,
  "sourceTimeUtc"          TIMESTAMPTZ NOT NULL,
  "createdAt"              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt"              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_push_auto_dispatch_category
    CHECK (category IN ('race_start', 'tv_start', 'results')),
  CONSTRAINT uq_push_auto_dispatch_event_category
    UNIQUE ("eventKey", category)
);

CREATE INDEX IF NOT EXISTS idx_push_auto_dispatch_scheduled
  ON push_auto_dispatch ("scheduledNotificationId");

ALTER TABLE push_auto_dispatch ENABLE ROW LEVEL SECURITY;

-- Lectura pública (panel admin la mostrará junto al listado de
-- programadas). Escritura solo desde la función SECURITY DEFINER.
CREATE POLICY "public_read_push_auto_dispatch"
  ON push_auto_dispatch FOR SELECT USING (true);

-- ── Función principal ────────────────────────────────────────────
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
  v_subtitle      TEXT;
BEGIN
  -- ╭────────────────────────────────────────────────────────────╮
  -- │ 1. race_start  ·  T-30 min de neutralStartTimeUtc           │
  -- ╰────────────────────────────────────────────────────────────╯
  FOR rec IN
    SELECT rd.id              AS race_day_id,
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
        id, title, subtitle, "deepLink", category, "scheduledAt", status, "createdBy"
      ) VALUES (
        v_new_id,
        rec.race_name,
        'Arranca la jornada en 30 minutos',
        'stage/' || rec.race_day_id,
        'race_start',
        v_scheduled_for,
        'pending',
        'auto_dispatch'
      );
      INSERT INTO push_auto_dispatch ("eventKey", category, "scheduledNotificationId", "sourceTimeUtc")
      VALUES (v_event_key, 'race_start', v_new_id, rec.source_time);
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
        id, title, subtitle, "deepLink", category, "scheduledAt", status, "createdBy"
      ) VALUES (
        v_new_id,
        rec.race_name,
        'Ya disponibles los resultados de la jornada',
        'stage/' || rec.race_day_id,
        'results',
        v_scheduled_for,
        'pending',
        'auto_dispatch'
      );
      INSERT INTO push_auto_dispatch ("eventKey", category, "scheduledNotificationId", "sourceTimeUtc")
      VALUES (v_event_key, 'results', v_new_id, rec.source_time);
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
  -- │ 3. tv_start · T-5 min del primer broadcast del día          │
  -- ╰────────────────────────────────────────────────────────────╯
  -- Una sola notificación por jornada (no por canal). Si hay 5
  -- emisiones simultáneas, no spamear con 5 pushes.
  FOR rec IN
    SELECT b."raceDayId"           AS race_day_id,
           MIN(b."startTimeUtc")   AS source_time,
           r.name                  AS race_name
    FROM broadcasts b
    JOIN race_days rd ON rd.id = b."raceDayId"
    JOIN races r ON r.id = rd."raceId"
    WHERE b."startTimeUtc" IS NOT NULL
      AND rd."isRestDay" = false
      AND rd."isCancelledDay" = false
      AND r."isCancelled" = false
    GROUP BY b."raceDayId", r.name
    HAVING MIN(b."startTimeUtc") BETWEEN v_now AND v_window_end
  LOOP
    v_event_key     := 'tvstart-' || rec.race_day_id;
    v_scheduled_for := rec.source_time - INTERVAL '5 minutes';
    IF v_scheduled_for <= v_now THEN CONTINUE; END IF;

    SELECT pad."scheduledNotificationId", pad."sourceTimeUtc"
      INTO v_existing_id, v_existing_src
    FROM push_auto_dispatch pad
    WHERE pad."eventKey" = v_event_key AND pad.category = 'tv_start';

    IF v_existing_id IS NULL THEN
      v_new_id := gen_random_uuid()::TEXT;
      INSERT INTO scheduled_push_notifications (
        id, title, subtitle, "deepLink", category, "scheduledAt", status, "createdBy"
      ) VALUES (
        v_new_id,
        rec.race_name,
        'Empieza la emisión por televisión',
        'stage/' || rec.race_day_id,
        'tv_start',
        v_scheduled_for,
        'pending',
        'auto_dispatch'
      );
      INSERT INTO push_auto_dispatch ("eventKey", category, "scheduledNotificationId", "sourceTimeUtc")
      VALUES (v_event_key, 'tv_start', v_new_id, rec.source_time);
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
  IS 'Programa notificaciones Premium (race_start/tv_start/results) en scheduled_push_notifications. Idempotente vía push_auto_dispatch. Devuelve un row por cada acción (inserted/rescheduled).';

-- Solo postgres / service_role debería invocarla. NO se otorga
-- EXECUTE a anon/authenticated por defecto — es una función de
-- mantenimiento, no una RPC pública.
REVOKE ALL ON FUNCTION public.auto_dispatch_premium_pushes(INTEGER) FROM PUBLIC;

-- ── pg_cron: ejecuta cada 10 min ─────────────────────────────────
-- Solo crea el job si no existe (idempotente).
SELECT cron.schedule(
  'auto-dispatch-premium-pushes',
  '*/10 * * * *',
  'SELECT public.auto_dispatch_premium_pushes();'
) WHERE NOT EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'auto-dispatch-premium-pushes'
);
