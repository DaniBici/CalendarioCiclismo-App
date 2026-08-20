-- ═══════════════════════════════════════════════════════════════════
--  PUSH SUBSCRIPTIONS — índice por plataforma
--  La edge function send-push agrupa los tokens activos por
--  plataforma ('ios' | 'android') para encaminar cada uno a su
--  gateway (APNs o FCM). Este índice parcial acelera ese filtro
--  sin duplicar datos para las filas desactivadas.
-- ═══════════════════════════════════════════════════════════════════

CREATE INDEX IF NOT EXISTS idx_push_subscriptions_platform_active
  ON push_subscriptions (platform)
  WHERE "isActive" = true;
