-- ═══════════════════════════════════════════════════════════════════
--  PUSH SUBSCRIPTIONS — Mejora de políticas RLS
-- ═══════════════════════════════════════════════════════════════════
--
--  Problema detectado por Supabase Advisor:
--    - La política SELECT "public_read_push_subscriptions" era pública
--      (anon + authenticated). Combinada con la política UPDATE sin
--      restricción, permitía a cualquier usuario anónimo:
--        1. Leer todos los device tokens y sus UUIDs.
--        2. Actualizar cualquier fila usando el UUID obtenido
--           (p. ej. deshabilitar notificaciones de cualquier usuario).
--
--  Solución (sin cambios en apps ni panel):
--    - SELECT: restringir a `authenticated` (el panel admin lo sigue
--      usando para contar suscriptores activos). Las apps nunca leen
--      esta tabla; la edge function send-push usa service role.
--    - INSERT / UPDATE para anon: sin cambios, siguen siendo
--      necesarias para que las apps registren/actualicen sus tokens
--      mediante upsert(onConflict: "deviceToken").
-- ═══════════════════════════════════════════════════════════════════

-- Eliminar la política SELECT pública (anon + authenticated sin TO)
DROP POLICY IF EXISTS "public_read_push_subscriptions" ON push_subscriptions;

-- Recrear SELECT solo para usuarios autenticados (panel admin)
CREATE POLICY "auth_read_push_subscriptions"
  ON push_subscriptions FOR SELECT
  TO authenticated
  USING (true);
