-- Revertir el sistema de canal debug Android: la feature no resuelve nada
-- útil (las notificaciones normales funcionan; el bug original era específico
-- de un canal recién creado en un dispositivo concreto). Volvemos al estado
-- pre-debug.

DROP INDEX IF EXISTS idx_push_subscriptions_debug;
ALTER TABLE push_subscriptions DROP COLUMN IF EXISTS "isDebug";
