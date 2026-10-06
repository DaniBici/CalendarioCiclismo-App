-- Recuperada el 2026-09-28 de supabase_migrations.schema_migrations.statements
-- (versión 20260606142955, nombre sim_rider_ratings_security_invoker). Texto aplicado en producción, sin cambios.

-- Evitar el lint 0010 (security_definer_view, nivel ERROR): la vista debe respetar
-- los permisos del invocador (security_invoker = on), y dar a anon acceso de LECTURA
-- directo a la tabla subyacente en su esquema. Así no se introduce un advisor nuevo.

-- 1) Acceso de lectura directo a la tabla de ratings para los roles del cliente web.
grant usage on schema game to anon, authenticated;
grant select on table game.rider_ratings to anon, authenticated;

-- 2) RLS de SOLO LECTURA en game.rider_ratings: habilitar RLS y una única política SELECT.
alter table game.rider_ratings enable row level security;
drop policy if exists sim_public_read on game.rider_ratings;
create policy sim_public_read on game.rider_ratings
  for select to anon, authenticated using (true);

-- 3) La vista pasa a security_invoker → respeta permisos/RLS del que consulta.
alter view public.sim_rider_ratings set (security_invoker = on);
