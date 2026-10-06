-- Recuperada el 2026-09-28 de supabase_migrations.schema_migrations.statements
-- (versión 20260525181916, nombre create_game_rider_ratings). Texto aplicado en producción, sin cambios.

create schema if not exists game;

create table game.rider_ratings (
  "riderId"      text    not null,
  gender         text    not null check (gender in ('M','W')),
  archetype      text,
  flat           smallint check (flat          between 0 and 99),
  hill           smallint check (hill          between 0 and 99),
  "medMountain"  smallint check ("medMountain"  between 0 and 99),
  "highMountain" smallint check ("highMountain" between 0 and 99),
  itt            smallint check (itt           between 0 and 99),
  prologue       smallint check (prologue      between 0 and 99),
  cobbles        smallint check (cobbles       between 0 and 99),
  sprint         smallint check (sprint        between 0 and 99),
  accel          smallint check (accel         between 0 and 99),
  endurance      smallint check (endurance     between 0 and 99),
  "recovDay"     smallint check ("recovDay"     between 0 and 99),
  "recovLong"    smallint check ("recovLong"    between 0 and 99),
  descending     smallint check (descending    between 0 and 99),
  positioning    smallint check (positioning   between 0 and 99),
  handling       smallint check (handling      between 0 and 99),
  experience     smallint check (experience    between 0 and 99),
  aggression     smallint check (aggression    between 0 and 99),
  headcraft      smallint check (headcraft     between 0 and 99),
  notes          text,
  source         text        not null default 'manual',
  verified       boolean     not null default false,
  "createdAt"    timestamptz not null default now(),
  "updatedAt"    timestamptz not null default now(),
  primary key ("riderId", gender)
);

comment on table  game.rider_ratings is 'Atributos de juego por corredor. Lee de riders_men/women por riderId; aislado del calendario en el esquema game.';
comment on column game.rider_ratings."riderId"      is 'id maestro en riders_men.id (M) o riders_women.id (W)';
comment on column game.rider_ratings.flat           is 'llano';
comment on column game.rider_ratings.hill           is 'cota';
comment on column game.rider_ratings."medMountain"  is 'media montaña';
comment on column game.rider_ratings."highMountain" is 'alta montaña';
comment on column game.rider_ratings.itt            is 'crono / contrarreloj';
comment on column game.rider_ratings.prologue       is 'prólogo';
comment on column game.rider_ratings.cobbles        is 'pavé';
comment on column game.rider_ratings.sprint         is 'sprint';
comment on column game.rider_ratings.accel          is 'aceleración';
comment on column game.rider_ratings.endurance      is 'resistencia';
comment on column game.rider_ratings."recovDay"     is 'recuperación en el día';
comment on column game.rider_ratings."recovLong"    is 'recuperación a largo plazo';
comment on column game.rider_ratings.descending     is 'descenso';
comment on column game.rider_ratings.positioning    is 'colocación';
comment on column game.rider_ratings.handling       is 'manejo de bici';
comment on column game.rider_ratings.experience     is 'experiencia';
comment on column game.rider_ratings.aggression     is 'combatividad';
comment on column game.rider_ratings.headcraft      is 'inteligencia / cabeza';
