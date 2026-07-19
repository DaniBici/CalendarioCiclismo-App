-- ─────────────────────────────────────────────────────────────────
--  051_push_auto_dispatch_skip_redundant_tv_start.sql
--
--  Evita doble notificación cuando hay retransmisión íntegra.
--
--  Problema previo:
--    En etapas con TV desde el banderazo (broadcast.startTimeUtc ≈
--    neutralStartTimeUtc), el sistema generaba dos notificaciones
--    separadas por ~25 minutos:
--      - race_start  →  T-30 min del banderazo
--      - tv_start    →  T-5  min del broadcast  (≈ T-5 del banderazo)
--
--  Solución:
--    En el bloque tv_start de auto_dispatch_premium_pushes(), antes de
--    programar la notificación se comprueba si el primer broadcast
--    visible para ese grupo country arranca dentro de los 30 minutos
--    posteriores al neutralStartTimeUtc (o antes de él). Si es así, la
--    notificación tv_start es redundante con race_start y se omite.
--
--    Si ya existía una tv_start pendiente para ese eventKey y ahora
--    resulta redundante (p.ej. el broadcast se adelantó), se cancela.
--
--    Cuando neutralStartTimeUtc no existe, no hay race_start y la
--    tv_start sigue siendo el único aviso al usuario → se mantiene.
--
--  Umbral elegido: 30 minutos
--    Cubre la casuística habitual de cobertura íntegra (broadcast
--    arranca 15-30 min antes del banderazo, exactamente al banderazo,
--    o hasta 30 min después). A partir de 30 min después del banderazo
--    la cobertura ya es tardía y el aviso tv_start aporta valor propio.
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
  -- ── 1. race_start · T-30 min de neutralStartTimeUtc ────────────
  FOR rec IN
    SELECT rd.id AS race_day_id, r.id AS race_id,
           rd."neutralStartTimeUtc" AS source_time, r.name AS race_name
    FROM race_days rd JOIN races r ON r.id = rd."raceId"
    WHERE rd."neutralStartTimeUtc" IS NOT NULL
      AND rd."isRestDay" = false AND rd."isCancelledDay" = false
      AND r."isCancelled" = false
      AND rd."neutralStartTimeUtc" BETWEEN v_now AND v_window_end
  LOOP
    v_event_key     := 'racestart-' || rec.race_day_id;
    v_scheduled_for := rec.source_time - INTERVAL '30 minutes';
    IF v_scheduled_for <= v_now THEN CONTINUE; END IF;
    SELECT pad."scheduledNotificationId", pad."sourceTimeUtc" INTO v_existing_id, v_existing_src
      FROM push_auto_dispatch pad
      WHERE pad."eventKey" = v_event_key AND pad.category = 'race_start';
    IF v_existing_id IS NULL THEN
      v_new_id := gen_random_uuid()::TEXT;
      INSERT INTO scheduled_push_notifications (id, title, subtitle, "deepLink", "raceId", category, "scheduledAt", status, "createdBy")
        VALUES (v_new_id, rec.race_name, 'Arranca la jornada en 30 minutos',
                'stage/' || rec.race_day_id, rec.race_id, 'race_start',
                v_scheduled_for, 'pending', 'auto_dispatch');
      INSERT INTO push_auto_dispatch ("eventKey", category, "scheduledNotificationId", "sourceTimeUtc", "raceId")
        VALUES (v_event_key, 'race_start', v_new_id, rec.source_time, rec.race_id);
      action := 'inserted'; event_key := v_event_key; category := 'race_start'; scheduled_at := v_scheduled_for;
      RETURN NEXT;
    ELSIF v_existing_src IS DISTINCT FROM rec.source_time THEN
      UPDATE scheduled_push_notifications SET "scheduledAt" = v_scheduled_for
        WHERE id = v_existing_id AND status = 'pending';
      UPDATE push_auto_dispatch SET "sourceTimeUtc" = rec.source_time, "updatedAt" = v_now
        WHERE "eventKey" = v_event_key AND category = 'race_start';
      action := 'rescheduled'; event_key := v_event_key; category := 'race_start'; scheduled_at := v_scheduled_for;
      RETURN NEXT;
    END IF;
  END LOOP;

  -- ── 2. results · T+30 min de estimatedFinishTimeUtc ────────────
  FOR rec IN
    SELECT rd.id AS race_day_id, r.id AS race_id,
           rd."estimatedFinishTimeUtc" AS source_time, r.name AS race_name
    FROM race_days rd JOIN races r ON r.id = rd."raceId"
    WHERE rd."estimatedFinishTimeUtc" IS NOT NULL
      AND rd."isRestDay" = false AND rd."isCancelledDay" = false
      AND r."isCancelled" = false
      AND rd."estimatedFinishTimeUtc" BETWEEN v_now AND v_window_end
  LOOP
    v_event_key     := 'results-' || rec.race_day_id;
    v_scheduled_for := rec.source_time + INTERVAL '30 minutes';
    IF v_scheduled_for <= v_now THEN CONTINUE; END IF;
    SELECT pad."scheduledNotificationId", pad."sourceTimeUtc" INTO v_existing_id, v_existing_src
      FROM push_auto_dispatch pad WHERE pad."eventKey" = v_event_key AND pad.category = 'results';
    IF v_existing_id IS NULL THEN
      v_new_id := gen_random_uuid()::TEXT;
      INSERT INTO scheduled_push_notifications (id, title, subtitle, "deepLink", "raceId", category, "scheduledAt", status, "createdBy")
        VALUES (v_new_id, rec.race_name, 'Ya disponibles los resultados de la jornada',
                'stage/' || rec.race_day_id, rec.race_id, 'results',
                v_scheduled_for, 'pending', 'auto_dispatch');
      INSERT INTO push_auto_dispatch ("eventKey", category, "scheduledNotificationId", "sourceTimeUtc", "raceId")
        VALUES (v_event_key, 'results', v_new_id, rec.source_time, rec.race_id);
      action := 'inserted'; event_key := v_event_key; category := 'results'; scheduled_at := v_scheduled_for;
      RETURN NEXT;
    ELSIF v_existing_src IS DISTINCT FROM rec.source_time THEN
      UPDATE scheduled_push_notifications SET "scheduledAt" = v_scheduled_for
        WHERE id = v_existing_id AND status = 'pending';
      UPDATE push_auto_dispatch SET "sourceTimeUtc" = rec.source_time, "updatedAt" = v_now
        WHERE "eventKey" = v_event_key AND category = 'results';
      action := 'rescheduled'; event_key := v_event_key; category := 'results'; scheduled_at := v_scheduled_for;
      RETURN NEXT;
    END IF;
  END LOOP;

  -- ── 3. tv_start · 1 por (jornada, grupo fino) con MIN visible ──
  -- Reglas de visibilidad (paridad con js/shared.js filterBroadcastsByRegion):
  --   - Todos los grupos: ALL.
  --   - Europeos (excepto UK_IE): + EUROPA.
  --   - UK_IE: NO recibe EUROPA.
  --   - Resto: solo su propio grupo + ALL.
  --
  -- NUEVO (migración 051): si el primer broadcast visible para el grupo
  -- arranca dentro de los 30 min posteriores al neutralStartTimeUtc (o
  -- antes), se omite tv_start porque race_start ya cubre ese aviso.
  -- Si ya existía una tv_start pendiente y ahora es redundante, se cancela.
  FOR rec IN
    SELECT b."raceDayId" AS race_day_id, r.id AS race_id, r.name AS race_name,
           gp.user_group,
           MIN(b."startTimeUtc") FILTER (WHERE b.country = ANY(gp.visible_groups)) AS source_time,
           rd."neutralStartTimeUtc" AS neutral_start
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
    GROUP BY b."raceDayId", r.id, r.name, gp.user_group, gp.visible_groups, rd."neutralStartTimeUtc"
    HAVING MIN(b."startTimeUtc") FILTER (WHERE b.country = ANY(gp.visible_groups))
           BETWEEN v_now AND v_window_end
  LOOP
    v_event_key := 'tvstart-' || rec.race_day_id || '-' || lower(rec.user_group);

    -- Omitir tv_start cuando hay cobertura íntegra:
    -- el broadcast arranca dentro de los 30 min siguientes al banderazo
    -- (o antes), y existe race_start que ya avisa T-30 al usuario.
    IF rec.neutral_start IS NOT NULL
       AND rec.source_time - rec.neutral_start <= INTERVAL '30 minutes' THEN
      -- Cancelar cualquier tv_start pendiente que ya no tiene sentido
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
      CONTINUE;
    END IF;

    v_scheduled_for := rec.source_time - INTERVAL '5 minutes';
    IF v_scheduled_for <= v_now THEN CONTINUE; END IF;
    SELECT pad."scheduledNotificationId", pad."sourceTimeUtc" INTO v_existing_id, v_existing_src
      FROM push_auto_dispatch pad WHERE pad."eventKey" = v_event_key AND pad.category = 'tv_start';
    IF v_existing_id IS NULL THEN
      v_new_id := gen_random_uuid()::TEXT;
      INSERT INTO scheduled_push_notifications (id, title, subtitle, "deepLink", "raceId", category, "targetCountryGroups", "scheduledAt", status, "createdBy")
        VALUES (v_new_id, rec.race_name, 'Empieza la emisión por televisión',
                'stage/' || rec.race_day_id, rec.race_id, 'tv_start',
                ARRAY[rec.user_group], v_scheduled_for, 'pending', 'auto_dispatch');
      INSERT INTO push_auto_dispatch ("eventKey", category, "scheduledNotificationId", "sourceTimeUtc", "raceId")
        VALUES (v_event_key, 'tv_start', v_new_id, rec.source_time, rec.race_id);
      action := 'inserted'; event_key := v_event_key; category := 'tv_start'; scheduled_at := v_scheduled_for;
      RETURN NEXT;
    ELSIF v_existing_src IS DISTINCT FROM rec.source_time THEN
      UPDATE scheduled_push_notifications SET "scheduledAt" = v_scheduled_for
        WHERE id = v_existing_id AND status = 'pending';
      UPDATE push_auto_dispatch SET "sourceTimeUtc" = rec.source_time, "updatedAt" = v_now
        WHERE "eventKey" = v_event_key AND category = 'tv_start';
      action := 'rescheduled'; event_key := v_event_key; category := 'tv_start'; scheduled_at := v_scheduled_for;
      RETURN NEXT;
    END IF;
  END LOOP;

  RETURN;
END;
$$;

COMMENT ON FUNCTION public.auto_dispatch_premium_pushes(INTEGER)
  IS 'Programa notificaciones Premium. race_start y results: 1 por jornada. tv_start: 1 por (jornada, grupo fino broadcasts.country) con MIN(startTimeUtc) visible para ese grupo. Se omite tv_start cuando el primer broadcast del grupo arranca dentro de los 30 min del neutralStartTimeUtc (cobertura íntegra: race_start ya cubre el aviso). Idempotente vía push_auto_dispatch.';
