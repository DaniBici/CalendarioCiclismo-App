-- Recuperada el 2026-09-28 de supabase_migrations.schema_migrations.statements
-- (versión 20260526055440, nombre game_race_sim). Texto aplicado en producción, sin cambios.

create table if not exists game.race_sim (
  "raceId"        text not null,
  seed            integer not null,
  "engineVersion" text not null,
  "tempC"         numeric,
  wet             boolean not null default false,
  finale          text,
  "ganadorId"     text,
  "ganadorNombre" text,
  "censoMeta"     integer,
  texto           text,           -- crónica live-texto ya renderizada (lo que sirve la web)
  hitos           jsonb,          -- eventos curados por el narrador
  log             jsonb,          -- log crudo del motor (fidelidad / UI propia)
  clasificacion   jsonb,          -- resultado final con huecos
  censos          jsonb,          -- censos de grupo por tramo
  "createdAt"     timestamptz not null default now(),
  "updatedAt"     timestamptz not null default now(),
  primary key ("raceId", seed, "engineVersion")
);
comment on table game.race_sim is 'Película precalculada de una carrera (determinista por semilla). La web LEE de aquí; el motor no se ejecuta en el camino del usuario. Se reescribe al cambiar ratings/roles/parcours/semilla o versión de motor.';
