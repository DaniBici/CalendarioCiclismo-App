-- ═══════════════════════════════════════════════════════════════════
--  PUSH SUBSCRIPTIONS — Revert de 012 (SELECT solo authenticated)
-- ═══════════════════════════════════════════════════════════════════
--
--  La migración 012 rompió el registro de tokens desde las apps: los
--  clientes Supabase (swift + kt) envían `Prefer: return=representation`
--  en upsert, lo que obliga a PostgREST a ejecutar un SELECT sobre la
--  fila devuelta. Con SELECT restringido a `authenticated`, ese SELECT
--  falla con "new row violates row-level security policy" y el upsert
--  completo es rechazado, así que ningún dispositivo anónimo consigue
--  registrar su token.
--
--  Se restaura la política SELECT pública para desbloquear producción
--  de forma inmediata. El endurecimiento real (mover el registro a una
--  RPC SECURITY DEFINER y quitar el acceso directo de `anon` a la
--  tabla) se hará en una migración posterior coordinada con una
--  release de las apps que llame a la RPC en vez de hacer upsert.
-- ═══════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "auth_read_push_subscriptions" ON push_subscriptions;

CREATE POLICY "public_read_push_subscriptions"
  ON push_subscriptions FOR SELECT USING (true);
