-- Identificador de la ficha del calendario UCI de carretera en `races`.
-- Clave del volcado idempotente del calendario no-WorldTour, paralela a
-- `cx_races."uciCalendarId"`. Permite detectar lo ya cargado y actualizar sin
-- duplicar ediciones. Nula en las ediciones anteriores a este contrato.
alter table public.races add column if not exists "uciCalendarId" text;

create unique index if not exists races_uci_calendar_id_key on public.races ("uciCalendarId");

comment on column public.races."uciCalendarId" is 'Identificador UCI de la prueba (competition-details/<año>/ROA/<id>).';
