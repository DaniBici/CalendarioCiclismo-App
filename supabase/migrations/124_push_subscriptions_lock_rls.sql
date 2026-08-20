-- ═══════════════════════════════════════════════════════════════════
--  PUSH SUBSCRIPTIONS — cerrar el acceso anónimo a la tabla
--  (el endurecimiento que la 013 dejó pendiente). FASE 1 de 2.
-- ═══════════════════════════════════════════════════════════════════
--
--  QUÉ HABÍA
--  Las cuatro políticas eran USING (true) SIN cláusula TO → aplicaban a
--  anon: SELECT, INSERT, UPDATE y DELETE abiertos a cualquiera con la
--  clave publishable, que va embebida en js/config.js y se sirve en cada
--  carga de la web. Con eso se podía:
--    · leer los 937 deviceToken con su region/countryGroup/language,
--    · desactivar las notificaciones de cualquiera (UPDATE isActive),
--    · borrar la tabla entera con un DELETE sin filtro — irrecuperable:
--      los tokens solo los regenera cada dispositivo al reinstalar.
--  Es el ataque que ya describía la 012 en su cabecera.
--
--  POR QUÉ AHORA SÍ SE PUEDE
--  La 012 intentó esto y rompió producción: los upserts de las apps
--  mandaban `Prefer: return=representation` → PostgREST hacía un SELECT
--  sobre la fila devuelta → sin política de SELECT para anon, el upsert
--  entero se rechazaba. La 013 lo revirtió dejando el plan escrito:
--  "coordinar con una release de las apps que llame a una RPC en vez de
--  hacer upsert". Esa release YA está en producción:
--    · iOS     → SupabaseService.swift:319 rpc("set_push_subscription_v3")
--    · Android → SupabaseService.kt:595    rpc("set_push_subscription_v3")
--  set_push_subscription_v3 es SECURITY DEFINER, su owner (postgres) tiene
--  rolbypassrls y la tabla NO tiene FORCE ROW LEVEL SECURITY → bypassa RLS.
--  VERIFICADO en caliente contra prod (con rollback): como rol anon y con
--  estas políticas aplicadas, la RPC registra el token correctamente.
--  Datos que lo respaldan: iOS y Android escribieron 83 y 107 veces en las
--  últimas 24 h; ninguna depende de estas políticas.
--
--  ⚠️ EL GRANT DE COLUMNA NO ES UN CAPRICHO
--  Un `DELETE ... WHERE "deviceToken" = x` necesita privilegio de LECTURA
--  para evaluar su propio filtro. Un REVOKE SELECT a secas rompe el DELETE
--  con "permission denied for table push_subscriptions" — probado en
--  caliente: se cargaba el borrado de datos RGPD de iOS/Android.
--  Por eso: GRANT SELECT ("deviceToken") — solo esa columna, la del filtro.
--  Y NO reabre la lectura: sin política de SELECT para anon, la RLS filtra
--  todas las filas igual (verificado: enumerar devuelve 0 filas). Las dos
--  capas colaboran — el privilegio permite evaluar el WHERE, la política
--  impide ver nada.
--
--  QUIÉN NECESITA QUÉ TRAS ESTA MIGRACIÓN
--    · anon          → registro por RPC v3; DELETE por token (RGPD). Nada más.
--    · authenticated → SELECT (panel: KPIs y selector de debug —
--                      js/panel.js:6958, 11620, 11814, 12070).
--    · service_role  → todo (send-push, pg_cron de limpieza). Salta RLS.
--
--  ⚠️ CORTA EL PUSH WEB — asumido con datos
--  js/push-web.js:48,64 es el ÚNICO cliente que ataca la tabla directamente
--  (POST upsert + PATCH isActive:false) sin pasar por la RPC. Esta migración
--  le corta el registro. El intercambio: la web tiene 5 suscripciones y
--  NINGUNA escritura desde 2026-05-20 (~2 meses), frente a 937 tokens
--  legibles y borrables por cualquiera. No está reñido.
--  Arreglo de la web (commit aparte, sin dependencia de releases): migrar a
--  set_push_subscription_v3 pasándole p_categories := ARRAY['general'] — la
--  web hoy se apoya en el trigger de categoría por defecto (push-web.js:34-38)
--  y la RPC exige el array explícito; sin eso se degrada el baseline gratuito.
--
--  FASE 2 — con la release 4.0 de las apps (final del Tour)
--  El DELETE de anon se acota aquí pero no desaparece: quien CONOZCA un token
--  ajeno aún puede borrar esa fila (no puede descubrirlo, que es lo que hacía
--  el ataque escalable). El cierre definitivo es una RPC
--  delete_push_subscription(p_token) SECURITY DEFINER + DROP de esta política
--  + REVOKE del GRANT de columna. Requiere tocar iOS (:336) y Android (:600),
--  que hoy hacen DELETE directo en deleteAllData → va en la 4.0.
-- ═══════════════════════════════════════════════════════════════════

-- ── SELECT: fuera de anon ──────────────────────────────────────────
-- Lo que hace escalable el ataque: sin poder ENUMERAR, quien no conozca ya
-- un token no tiene nada que atacar. El panel (authenticated) sigue igual.
DROP POLICY IF EXISTS "public_read_push_subscriptions" ON push_subscriptions;

CREATE POLICY "auth_read_push_subscriptions"
  ON push_subscriptions FOR SELECT
  TO authenticated
  USING (true);

-- ── INSERT / UPDATE: fuera de anon ─────────────────────────────────
-- Las apps van por set_push_subscription_v3, que hace su
-- ON CONFLICT ("deviceToken") DO UPDATE saltando RLS.
DROP POLICY IF EXISTS "anon_insert_push_subscriptions" ON push_subscriptions;
DROP POLICY IF EXISTS "anon_update_push_subscriptions" ON push_subscriptions;

-- ── DELETE: acotado (fase 1), no eliminado ─────────────────────────
-- Se conserva para deleteAllData de iOS/Android. Deja de ser un
-- "DELETE FROM push_subscriptions" masivo: exige filtrar por deviceToken.
DROP POLICY IF EXISTS "anon_delete_push_subscriptions" ON push_subscriptions;

CREATE POLICY "anon_delete_own_push_subscription"
  ON push_subscriptions FOR DELETE
  TO anon
  USING ("deviceToken" IS NOT NULL);

-- ── Privilegios de tabla ───────────────────────────────────────────
-- La RLS filtra filas; el GRANT es la puerta. Que las dos capas digan lo
-- mismo (defensa en profundidad): sin esto, anon conserva el privilegio de
-- SELECT/INSERT/UPDATE y solo le frena la política.
REVOKE ALL ON push_subscriptions FROM anon;
GRANT DELETE ON push_subscriptions TO anon;
GRANT SELECT ("deviceToken") ON push_subscriptions TO anon;  -- solo para el WHERE del DELETE
GRANT SELECT ON push_subscriptions TO authenticated;

COMMENT ON TABLE push_subscriptions IS
  'Tokens de push por dispositivo. anon NO tiene acceso directo de lectura ni '
  'escritura: el registro va por set_push_subscription_v3 (SECURITY DEFINER). '
  'Conserva DELETE filtrado por deviceToken para el borrado RGPD de las apps '
  '(fase 2: RPC delete_push_subscription en la release 4.0). Lectura: '
  'authenticated (panel) y service_role (send-push, pg_cron). Ver migración 124.';
