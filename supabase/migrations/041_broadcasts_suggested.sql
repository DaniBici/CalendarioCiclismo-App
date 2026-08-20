-- broadcasts_suggested: sugerencias de broadcasts pendientes de revisión humana
-- antes de promoverse a la tabla `broadcasts` real.
--
-- Una utilidad de importación rellena esta tabla con sugerencias nuevas. El
-- editor humano las revisa en el panel y las acepta o rechaza. Solo las
-- aceptadas se copian a `broadcasts` con sus campos finales.
-- (Tabla y utilidad retiradas después; ver migración 127.)

CREATE TABLE IF NOT EXISTS broadcasts_suggested (
  id              TEXT PRIMARY KEY,
  "raceDayId"     TEXT REFERENCES race_days(id) ON DELETE CASCADE,
  channel         TEXT NOT NULL,
  country         TEXT,
  "localStartTime" TEXT,            -- HH:MM tal como aparece en la fuente (opcional)
  "isFree"        BOOLEAN NOT NULL DEFAULT false,
  source          TEXT NOT NULL DEFAULT 'import',
  "sourceUrl"     TEXT,             -- URL de la página de la fuente para verificar
  "sourceRaceName" TEXT,            -- nombre que la fuente da a la carrera (para debug del matching)
  "sourceCountryIso" TEXT,          -- código ISO original antes de mapear al grupo (debug)
  "matchConfidence" TEXT,           -- 'exact' | 'lax' | 'only-of-day'
  status          TEXT NOT NULL DEFAULT 'pending',  -- 'pending' | 'accepted' | 'rejected'
  "suggestedAt"   TIMESTAMPTZ NOT NULL DEFAULT now(),
  "reviewedAt"    TIMESTAMPTZ,
  "reviewedBy"    TEXT,
  "appliedBroadcastId" TEXT REFERENCES broadcasts(id) ON DELETE SET NULL,
  -- Constraints
  CONSTRAINT broadcasts_suggested_status_check
    CHECK (status IN ('pending', 'accepted', 'rejected')),
  CONSTRAINT broadcasts_suggested_country_check
    CHECK (country IS NULL OR country IN (
      'ALL',
      'ES', 'EUROPA', 'PT', 'FR', 'BE', 'NL', 'IT', 'DE_AT_CH', 'UK_IE', 'SCANDI', 'EE',
      'LATAM', 'NORTEAM', 'ASIAPAC', 'AFRICA', 'MENA'
    ))
);

-- Evitar duplicados de la misma fuente para el mismo race_day + canal + país.
-- Si la importación ve el mismo broadcaster dos veces (ej: re-ejecución),
-- el segundo INSERT debe ser idempotente.
CREATE UNIQUE INDEX IF NOT EXISTS idx_broadcasts_suggested_unique
  ON broadcasts_suggested ("raceDayId", source, channel, country);

-- Índice para la consulta más común del panel: pendientes por fecha
CREATE INDEX IF NOT EXISTS idx_broadcasts_suggested_pending
  ON broadcasts_suggested ("suggestedAt" DESC)
  WHERE status = 'pending';

-- Índice para resolver "sugerencias de esta race_day" en el editor
CREATE INDEX IF NOT EXISTS idx_broadcasts_suggested_racedayid
  ON broadcasts_suggested ("raceDayId", status);

-- RLS
ALTER TABLE broadcasts_suggested ENABLE ROW LEVEL SECURITY;

-- Admins (autenticados con Supabase Auth en el panel) pueden hacer todo.
CREATE POLICY "auth_full" ON broadcasts_suggested
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- El workflow usa service_role y por tanto salta RLS — no necesita policy.
-- No hay acceso para `anon` (no es información pública).
