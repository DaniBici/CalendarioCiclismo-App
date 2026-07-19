-- ═══════════════════════════════════════════════════════════════════
--  PUSH SUBSCRIPTIONS — Política DELETE para anon
-- ═══════════════════════════════════════════════════════════════════
--
--  Sin esta política, el derecho de supresión (deleteAllData en las
--  apps) fallaba silenciosamente: PostgREST rechazaba el DELETE de
--  anon sin devolver error explícito. Al fallar, deleteAllData()
--  retornaba false antes de limpiar el estado local, dejando el token
--  en UserDefaults/DataStore y permitiendo que heal-on-launch lo
--  re-registrase en el siguiente arranque.
--
--  Consistente con las políticas INSERT y UPDATE existentes (ambas
--  USING/WITH CHECK true para anon): el modelo de seguridad actual
--  confía en que solo el dispositivo conoce su propio token.
-- ═══════════════════════════════════════════════════════════════════

CREATE POLICY "anon_delete_push_subscriptions"
  ON push_subscriptions FOR DELETE
  TO anon
  USING (true);
