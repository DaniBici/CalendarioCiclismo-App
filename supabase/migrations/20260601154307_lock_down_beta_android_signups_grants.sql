-- Recuperada el 2026-09-28 de supabase_migrations.schema_migrations.statements
-- (versión 20260601154307, nombre lock_down_beta_android_signups_grants). Texto aplicado en producción, sin cambios.

-- beta_android_signups contiene 190 emails de beta-testers (datos personales).
-- Se escribe SOLO desde la edge function beta-android-signup (service_role),
-- nunca desde el cliente. anon/authenticated tenían grants completos
-- (SELECT/INSERT/UPDATE/DELETE) sin uso; hoy RLS-sin-policy los bloquea, pero
-- los grants son superficie innecesaria y peligrosa si se añadiera una policy.
-- Revocar no afecta a la edge function (service_role ignora estos grants).
REVOKE ALL ON TABLE public.beta_android_signups FROM anon, authenticated;
