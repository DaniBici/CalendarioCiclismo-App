-- Recuperada el 2026-09-28 de supabase_migrations.schema_migrations.statements
-- (versión 20260526075521, nombre race_sim_add_wind_escenario_estados). Texto aplicado en producción, sin cambios.

alter table game.race_sim
  add column if not exists wind numeric,
  add column if not exists escenario text,
  add column if not exists "ganadorEquipo" text,
  add column if not exists dnf jsonb,
  add column if not exists "estadosVivo" jsonb;
comment on column game.race_sim.wind is 'Nivel de viento 0..1 del dia (alimenta los abanicos, factor B).';
comment on column game.race_sim.escenario is 'Modo de final del dia (factor F): grupo|fugaCorta|solo.';
comment on column game.race_sim."ganadorEquipo" is 'Equipo del ganador (display).';
comment on column game.race_sim.dnf is 'Abandonos del dia (array de riderId).';
comment on column game.race_sim."estadosVivo" is 'Estados en vivo enriquecidos (composicion de grupos por tramo) para el live-texto.';
