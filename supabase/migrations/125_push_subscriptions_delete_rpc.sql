-- ═══════════════════════════════════════════════════════════════════
--  PUSH SUBSCRIPTIONS — cierre definitivo del acceso anónimo. FASE 2 de 2.
--
--  ⛔ NO APLICAR TODAVÍA — VA CON LA RELEASE 4.0 DE LAS APPS ⛔
--
--  Requiere que iOS y Android llamen a delete_push_subscription() en vez
--  de hacer DELETE directo. Aplicarla ANTES de que esas builds estén en
--  manos de los usuarios ROMPE el borrado de datos (RGPD) de las apps ya
--  publicadas: su DELETE empezaría a devolver "permission denied".
--
--  ORDEN OBLIGATORIO:
--    1. Publicar 4.0 (iOS + Android) con los cambios de código de abajo.
--    2. Esperar a que la adopción sea razonable (las versiones <4.0 siguen
--       funcionando: conservan su DELETE hasta este punto).
--    3. Aplicar ESTA migración.
--  Invertir el orden es el error que hay que evitar. No hay prisa: la
--  fase 1 (migración 124) ya cerró el ataque escalable.
-- ═══════════════════════════════════════════════════════════════════
--
--  QUÉ CIERRA
--  La 124 dejó a anon con un único acceso directo: DELETE filtrado por
--  deviceToken (lo usan iOS SupabaseService.swift:336 y Android
--  SupabaseService.kt:600 en deleteAllData, derecho de supresión RGPD).
--  Sin SELECT, nadie puede DESCUBRIR tokens ajenos — el ataque escalable
--  ya está muerto. Pero quien CONOZCA un token (p. ej. el suyo en otro
--  dispositivo, o uno filtrado por otra vía) todavía puede borrar esa fila.
--  Esta migración lo elimina: el borrado pasa por una RPC SECURITY DEFINER
--  y anon se queda SIN NINGÚN privilegio sobre la tabla.
--
--  CAMBIOS DE CÓDIGO QUE ACOMPAÑAN (deben ir en la 4.0, ANTES de aplicar)
--
--  iOS — ios-app/CalendarioCiclismo/Services/SupabaseService.swift:336
--    ANTES:  try await client.from("push_subscriptions")
--              .delete().eq("deviceToken", value: token).execute()
--    DESPUÉS: try await client.rpc("delete_push_subscription",
--               params: ["p_token": token]).execute()
--
--  Android — android-app/app/src/main/java/.../data/remote/SupabaseService.kt:600
--    ANTES:  postgrest.from("push_subscriptions")
--              .delete { filter { eq("deviceToken", token) } }
--    DESPUÉS: postgrest.rpc("delete_push_subscription",
--               buildJsonObject { put("p_token", token) })
--
--  Llamadores (no cambian): iOS NotificationManager.swift:215,
--  Android PushNotificationManager.kt:177 — ambos en deleteAllData().
--
--  ⚠️ La RPC borra la fila de push_subscriptions; sus tablas hijas
--  (push_subscription_categories, push_race_subscriptions, push_race_filters,
--  push_stage_subscriptions) caen por FK ON DELETE CASCADE. Verificar que
--  siguen teniendo el CASCADE antes de aplicar; si alguna no lo tuviera,
--  añadir su DELETE explícito a la RPC o quedarían filas huérfanas.
--
--  WEB: js/push-web.js no hace DELETE (su baja es un PATCH isActive:false),
--  así que esta migración no le afecta. Su INSERT/UPDATE ya los cortó la 124
--  — el arreglo de la web (migrarla a set_push_subscription_v3 con
--  p_categories := ARRAY['general']) es un commit aparte, sin dependencia
--  de releases.
-- ═══════════════════════════════════════════════════════════════════

-- ── RPC de borrado (derecho de supresión) ──────────────────────────
-- SECURITY DEFINER: se ejecuta como su owner (postgres, rolbypassrls) →
-- salta RLS, igual que set_push_subscription_v3. anon no necesita ningún
-- privilegio sobre la tabla para invocarla.
CREATE OR REPLACE FUNCTION delete_push_subscription(p_token text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
-- search_path fijo: sin esto, un search_path manipulado por el llamante
-- podría resolver `push_subscriptions` a otra tabla y ejecutarse con los
-- privilegios del owner. Obligatorio en toda función SECURITY DEFINER.
SET search_path = public, pg_temp
AS $$
BEGIN
  -- Guard: sin token no se borra nada. Un p_token NULL con un
  -- `WHERE "deviceToken" = NULL` no borraría filas (NULL nunca iguala),
  -- pero el guard lo hace explícito y barato.
  IF p_token IS NULL OR btrim(p_token) = '' THEN
    RETURN;
  END IF;

  -- Solo la fila de ESE token. La RPC no acepta filtros del llamante, así
  -- que no hay forma de convertirla en un borrado masivo.
  DELETE FROM push_subscriptions WHERE "deviceToken" = p_token;
END;
$$;

COMMENT ON FUNCTION delete_push_subscription(text) IS
  'Borra la suscripción push de un deviceToken (derecho de supresión RGPD). '
  'SECURITY DEFINER: permite a las apps borrar la suya sin que anon tenga '
  'privilegios sobre push_subscriptions. Llamada desde deleteAllData() en '
  'iOS y Android (4.0+). Ver migración 125.';

REVOKE ALL ON FUNCTION delete_push_subscription(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION delete_push_subscription(text) TO anon, authenticated;

-- ── anon pierde TODO acceso directo a la tabla ─────────────────────
DROP POLICY IF EXISTS "anon_delete_own_push_subscription" ON push_subscriptions;

-- Incluye el GRANT SELECT ("deviceToken") de la 124, que solo existía para
-- que el DELETE pudiera evaluar su WHERE. Sin DELETE directo, sobra.
REVOKE ALL ON push_subscriptions FROM anon;

COMMENT ON TABLE push_subscriptions IS
  'Tokens de push por dispositivo. anon NO tiene NINGÚN acceso directo: '
  'registro por set_push_subscription_v3 y borrado por delete_push_subscription '
  '(ambas SECURITY DEFINER). Lectura: authenticated (panel) y service_role '
  '(send-push, pg_cron). Ver migraciones 124 y 125.';
