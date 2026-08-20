-- ─────────────────────────────────────────────────────────────────
--  048_push_target_country_groups.sql
--
--  Añade `targetCountryGroups TEXT[]` a `scheduled_push_notifications`
--  y `push_notifications` para segmentar envíos por el grupo fino
--  `broadcasts.country` del usuario (no el bucket continental
--  `region`). Lo usa `auto_dispatch_premium_pushes` para que la
--  notificación `tv_start` salga al horario del primer canal visible
--  para el grupo fino del usuario.
--
--  Coexiste con `targetRegions` (5 buckets) — son ortogonales: uno
--  filtra contra `push_subscriptions.region`, el otro contra
--  `push_subscriptions.countryGroup`.
--
--  NULL / [] = sin filtro. Si se rellena, debe ser un array no vacío
--  de valores del CHECK.
-- ─────────────────────────────────────────────────────────────────

-- ── scheduled_push_notifications ─────────────────────────────────
ALTER TABLE scheduled_push_notifications
  ADD COLUMN IF NOT EXISTS "targetCountryGroups" TEXT[] NULL;

ALTER TABLE scheduled_push_notifications
  DROP CONSTRAINT IF EXISTS chk_scheduled_push_target_country_groups;

ALTER TABLE scheduled_push_notifications
  ADD CONSTRAINT chk_scheduled_push_target_country_groups
    CHECK (
      "targetCountryGroups" IS NULL
      OR (
        array_length("targetCountryGroups", 1) IS NOT NULL
        AND "targetCountryGroups" <@ ARRAY[
          'ES','PT','FR','BE','NL','IT',
          'DE_AT_CH','UK_IE','SCANDI','EE',
          'NORTEAM','LATAM',
          'ASIAPAC','MENA',
          'AFRICA'
        ]::TEXT[]
      )
    );

-- ── push_notifications (historial) ───────────────────────────────
ALTER TABLE push_notifications
  ADD COLUMN IF NOT EXISTS "targetCountryGroups" TEXT[] NULL;

ALTER TABLE push_notifications
  DROP CONSTRAINT IF EXISTS chk_push_target_country_groups;

ALTER TABLE push_notifications
  ADD CONSTRAINT chk_push_target_country_groups
    CHECK (
      "targetCountryGroups" IS NULL
      OR (
        array_length("targetCountryGroups", 1) IS NOT NULL
        AND "targetCountryGroups" <@ ARRAY[
          'ES','PT','FR','BE','NL','IT',
          'DE_AT_CH','UK_IE','SCANDI','EE',
          'NORTEAM','LATAM',
          'ASIAPAC','MENA',
          'AFRICA'
        ]::TEXT[]
      )
    );
