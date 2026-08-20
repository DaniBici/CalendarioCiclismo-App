-- Identidad estable de una prueba a través de sus ediciones anuales.
-- `races` continúa siendo la edición concreta (fechas, recorrido, resultados,
-- inscritos, etc.); esta tabla solo agrupa las ediciones que son la misma
-- carrera deportiva.
create table public.race_series (
  id text primary key,
  "canonicalName" text not null,
  gender text,
  "createdAt" timestamptz not null default now()
);

comment on table public.race_series is
  'Identidad estable de una carrera; races representa una edición anual.';

alter table public.races
  add column "raceSeriesId" text references public.race_series(id) on delete restrict;

create index idx_races_race_series_id on public.races ("raceSeriesId");

alter table public.race_series enable row level security;

-- La API pública puede resolver la relación; las mutaciones se limitan al
-- panel autenticado y autorizado, como el resto de tablas editoriales.
revoke all on table public.race_series from public, anon, authenticated;
grant select on table public.race_series to anon, authenticated;
grant insert, update, delete on table public.race_series to authenticated;

create policy "public_read_race_series"
  on public.race_series for select to public using (true);

create policy "race_series_write_ins"
  on public.race_series for insert to authenticated
  with check ((select private.is_admin()));

create policy "race_series_write_upd"
  on public.race_series for update to authenticated
  using ((select private.is_admin()))
  with check ((select private.is_admin()));

create policy "race_series_write_del"
  on public.race_series for delete to authenticated
  using ((select private.is_admin()));
