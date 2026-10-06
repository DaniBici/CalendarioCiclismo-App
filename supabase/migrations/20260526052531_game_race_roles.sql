-- Recuperada el 2026-09-28 de supabase_migrations.schema_migrations.statements
-- (versión 20260526052531, nombre game_race_roles). Texto aplicado en producción, sin cambios.

create table if not exists game.race_roles (
  "raceId"     text not null,
  "riderId"    text not null,
  gender       text not null default 'M',
  rol          text not null check (rol in ('lider','sprinter','colider','lanzador','fuga','rodador','gregario','libre')),
  "rolDefault" text check ("rolDefault" in ('lider','sprinter','colider','lanzador','fuga','rodador','gregario','libre')),
  source       text not null default 'roles_auto',
  notes        text,
  "createdAt"  timestamptz not null default now(),
  "updatedAt"  timestamptz not null default now(),
  primary key ("raceId","riderId",gender)
);
comment on table game.race_roles is 'Eje 2 (ROL) por-carrera: lo que hace cada corredor en una carrera concreta. Separado de game.rider_ratings (Eje 1, rasgo estable). rolDefault guarda el reparto deducido por engine/roles.js para detectar ediciones manuales.';
