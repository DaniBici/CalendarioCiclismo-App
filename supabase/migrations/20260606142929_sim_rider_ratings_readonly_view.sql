-- Recuperada el 2026-09-28 de supabase_migrations.schema_migrations.statements
-- (versión 20260606142929, nombre sim_rider_ratings_readonly_view). Texto aplicado en producción, sin cambios.

-- Banco de pruebas del simulador: exponer los ratings (game.rider_ratings) en
-- SOLO LECTURA al cliente web SIN abrir el esquema 'game' a PostgREST.
-- Patrón: vista en 'public' (ya expuesto) propiedad de postgres; con
-- security_invoker apagado (default) la vista lee 'game' con permisos del owner,
-- así que anon puede consultarla aunque no tenga acceso directo al esquema game.
-- Solo se exponen los campos que el motor necesita; nada sensible.

create or replace view public.sim_rider_ratings as
select
  "riderId", gender, archetype,
  flat, hill, "medMountain", "highMountain", itt, prologue, cobbles, sprint,
  accel, endurance, "recovDay", "recovLong", descending, positioning, handling,
  experience, aggression, headcraft,
  role, "roleDefault"
from game.rider_ratings;

-- Lectura pública (datos no sensibles: notas 0-99). La vista no es actualizable.
grant select on public.sim_rider_ratings to anon, authenticated;

comment on view public.sim_rider_ratings is
  'Solo-lectura de game.rider_ratings para el banco de pruebas del simulador (calendariociclismo.app/sim/). Expone los 19 campos + arquetipo/rol. No editable.';
