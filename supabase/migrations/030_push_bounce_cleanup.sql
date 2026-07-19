-- ─────────────────────────────────────────────────────────────────
--  030_push_bounce_cleanup.sql
--
--  Añade política de bounces suaves y limpieza programada de tokens
--  inactivos en push_subscriptions.
--
--  • failCount     — incrementa en cada fallo transitorio (errores de
--                    red, respuestas HTTP que no son hard bounce). Al
--                    alcanzar el umbral (5), el token se desactiva.
--  • lastFailedAt  — timestamp del último fallo registrado.
--  • pg_cron job   — elimina cada día los tokens inactivos con más de
--                    30 días desde su última actualización.
-- ─────────────────────────────────────────────────────────────────

-- ── Columnas nuevas ──────────────────────────────────────────────
ALTER TABLE push_subscriptions
  ADD COLUMN IF NOT EXISTS "failCount"    INTEGER     NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "lastFailedAt" TIMESTAMPTZ;

-- ── Función: incrementa failCount y desactiva al llegar al umbral ─
CREATE OR REPLACE FUNCTION increment_push_fail_count(
  p_tokens    TEXT[],
  p_threshold INTEGER DEFAULT 5
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE push_subscriptions
  SET
    "failCount"    = "failCount" + 1,
    "lastFailedAt" = NOW(),
    "isActive"     = CASE
                       WHEN "failCount" + 1 >= p_threshold THEN false
                       ELSE "isActive"
                     END,
    "updatedAt"    = NOW()
  WHERE "deviceToken" = ANY(p_tokens);
END;
$$;

-- ── Función: resetea failCount tras envío exitoso ────────────────
CREATE OR REPLACE FUNCTION reset_push_fail_count(p_tokens TEXT[])
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE push_subscriptions
  SET "failCount" = 0,
      "updatedAt" = NOW()
  WHERE "deviceToken" = ANY(p_tokens)
    AND "failCount" > 0;
END;
$$;

-- ── pg_cron: limpieza diaria de tokens inactivos (≥ 30 días) ─────
SELECT cron.schedule(
  'cleanup-inactive-push-tokens',
  '0 4 * * *',
  $$
    DELETE FROM push_subscriptions
    WHERE "isActive" = false
      AND "updatedAt" < NOW() - INTERVAL '30 days';
  $$
);
