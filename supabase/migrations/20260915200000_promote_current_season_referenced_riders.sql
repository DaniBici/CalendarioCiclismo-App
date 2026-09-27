-- Promociona las fichas marcadas como solo-históricas cuando la temporada
-- vigente las referencia: una ficha presente en una startlist o en un
-- resultado de este año deja de estar oculta para los clientes publicados
-- (política public_read_*: NOT "historicalCatalogOnly").
--
-- Motivo: Juegos Suramericanos CRI masculino 2026 — el ganador vinculado a
-- una ficha nacida del catálogo histórico (source='uci_historical') quedaba
-- invisible para apps y web, y el feed de Últimos resultados mostraba la fila
-- sin nombre de ganador. La promoción existente solo cubría afiliaciones de
-- equipo (promote_current_historical_rider), insuficiente para selecciones
-- nacionales y carreras sin equipo.
begin;

-- Respaldo previo de las fichas que se promocionan.
create table private.historical_rider_promotions_20260915_backup (
  "repairKey" text not null,
  entity text not null,
  "rowKey" text not null,
  before jsonb not null,
  "backedUpAt" timestamptz not null default clock_timestamp(),
  primary key ("repairKey", entity, "rowKey")
);

revoke all on private.historical_rider_promotions_20260915_backup
  from public, anon, authenticated, service_role;
grant select on private.historical_rider_promotions_20260915_backup to service_role;

-- Promoción de una ficha por género; sin género conocido, prueba ambas tablas
-- (los ids son slugs únicos: la tabla errada afecta a cero filas).
create or replace function private.promote_referenced_rider(
  p_gender text,
  p_rider_id text
) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_rider_id is null or p_rider_id = '' then
    return;
  end if;
  if p_gender = 'male' or p_gender is null then
    update public.riders_men
    set "historicalCatalogOnly" = false, "updatedAt" = clock_timestamp()
    where id = p_rider_id and "historicalCatalogOnly" = true;
  end if;
  if p_gender = 'female' or p_gender is null then
    update public.riders_women
    set "historicalCatalogOnly" = false, "updatedAt" = clock_timestamp()
    where id = p_rider_id and "historicalCatalogOnly" = true;
  end if;
end;
$$;

revoke all on function private.promote_referenced_rider(text, text)
  from public, anon, authenticated, service_role;

-- Promoción al entrar en una startlist de la temporada vigente.
create or replace function private.promote_startlist_referenced_rider()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_year integer;
  v_gender text;
begin
  if new."globalRiderId" is null or new."globalRiderId" = '' then
    return new;
  end if;
  select r."year", r.gender into v_year, v_gender
  from public.races r
  where r.id = new."raceId";
  if v_year = extract(year from current_date)::integer then
    perform private.promote_referenced_rider(v_gender, new."globalRiderId");
  end if;
  return new;
end;
$$;

revoke all on function private.promote_startlist_referenced_rider()
  from public, anon, authenticated, service_role;

drop trigger if exists promote_startlist_referenced_rider on public.startlist_riders;
create trigger promote_startlist_referenced_rider
  after insert or update of "raceId", "globalRiderId"
  on public.startlist_riders
  for each row execute function private.promote_startlist_referenced_rider();

-- Promoción al entrar en un resultado in-house de la temporada vigente.
create or replace function private.promote_result_referenced_rider()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_year integer;
  v_gender text;
begin
  if new."globalRiderId" is null or new."globalRiderId" = '' then
    return new;
  end if;
  select r."year", r.gender into v_year, v_gender
  from public.races r
  where r.id = new."raceId";
  if v_year = extract(year from current_date)::integer then
    perform private.promote_referenced_rider(v_gender, new."globalRiderId");
  end if;
  return new;
end;
$$;

revoke all on function private.promote_result_referenced_rider()
  from public, anon, authenticated, service_role;

drop trigger if exists promote_result_referenced_rider on public.race_uci_results;
create trigger promote_result_referenced_rider
  after insert or update of "raceId", "globalRiderId"
  on public.race_uci_results
  for each row execute function private.promote_result_referenced_rider();

-- Blindar el marcado histórico de corredores: ni la inserción de catálogo ni
-- una reescritura posterior (source o el propio flag) pueden ocultar una
-- ficha ya referenciada por la temporada vigente (afiliación regular,
-- startlist o resultado). Los equipos conservan la semántica original.
create or replace function private.mark_historical_catalog_row() returns trigger
language plpgsql set search_path='' as $$
declare
  v_referenced boolean;
begin
  if tg_table_name = 'teams' then
    new."historicalCatalogOnly" := coalesce(current_setting('app.historical_catalog', true), '') = 'on';
    return new;
  end if;

  select
    exists (
      select 1 from public.rider_team_affiliations a
      where a."riderId" = new.id
        and a."riderGender" = (case tg_table_name when 'riders_men' then 'male' else 'female' end)
        and a.year = extract(year from current_date)::integer
        and a."affiliationType" = 'regular'
    )
    or exists (
      select 1
      from public.startlist_riders sr
      join public.races r on r.id = sr."raceId"
      where sr."globalRiderId" = new.id
        and r."year" = extract(year from current_date)::integer
    )
    or exists (
      select 1
      from public.race_uci_results res
      join public.races r on r.id = res."raceId"
      where res."globalRiderId" = new.id
        and r."year" = extract(year from current_date)::integer
    )
  into v_referenced;

  new."historicalCatalogOnly" := new.source = 'uci_historical' and not v_referenced;
  return new;
end;
$$;

drop trigger if exists mark_historical_catalog_rider_men on public.riders_men;
create trigger mark_historical_catalog_rider_men
  before insert or update of "source", "historicalCatalogOnly"
  on public.riders_men
  for each row execute function private.mark_historical_catalog_row();
drop trigger if exists mark_historical_catalog_rider_women on public.riders_women;
create trigger mark_historical_catalog_rider_women
  before insert or update of "source", "historicalCatalogOnly"
  on public.riders_women
  for each row execute function private.mark_historical_catalog_row();

-- Reparación única: respalda y promociona todas las fichas marcadas que la
-- temporada vigente ya referencia.
insert into private.historical_rider_promotions_20260915_backup
  ("repairKey", entity, "rowKey", before)
select 'HIST-SEASON-REF-2026', 'riders_men', r.id, to_jsonb(r)
from public.riders_men r
where r."historicalCatalogOnly" = true
  and (
    exists (
      select 1 from public.startlist_riders sr
      join public.races ra on ra.id = sr."raceId"
      where sr."globalRiderId" = r.id
        and ra."year" = extract(year from current_date)::integer
    )
    or exists (
      select 1 from public.race_uci_results res
      join public.races ra on ra.id = res."raceId"
      where res."globalRiderId" = r.id
        and ra."year" = extract(year from current_date)::integer
    )
    or exists (
      select 1 from public.rider_team_affiliations a
      where a."riderId" = r.id
        and a."riderGender" = 'male'
        and a.year = extract(year from current_date)::integer
        and a."affiliationType" = 'regular'
    )
  );

insert into private.historical_rider_promotions_20260915_backup
  ("repairKey", entity, "rowKey", before)
select 'HIST-SEASON-REF-2026', 'riders_women', r.id, to_jsonb(r)
from public.riders_women r
where r."historicalCatalogOnly" = true
  and (
    exists (
      select 1 from public.startlist_riders sr
      join public.races ra on ra.id = sr."raceId"
      where sr."globalRiderId" = r.id
        and ra."year" = extract(year from current_date)::integer
    )
    or exists (
      select 1 from public.race_uci_results res
      join public.races ra on ra.id = res."raceId"
      where res."globalRiderId" = r.id
        and ra."year" = extract(year from current_date)::integer
    )
    or exists (
      select 1 from public.rider_team_affiliations a
      where a."riderId" = r.id
        and a."riderGender" = 'female'
        and a.year = extract(year from current_date)::integer
        and a."affiliationType" = 'regular'
    )
  );

update public.riders_men r
set "historicalCatalogOnly" = false, "updatedAt" = clock_timestamp()
where r."historicalCatalogOnly" = true
  and exists (
    select 1 from private.historical_rider_promotions_20260915_backup b
    where b."repairKey" = 'HIST-SEASON-REF-2026'
      and b.entity = 'riders_men'
      and b."rowKey" = r.id
  );

update public.riders_women r
set "historicalCatalogOnly" = false, "updatedAt" = clock_timestamp()
where r."historicalCatalogOnly" = true
  and exists (
    select 1 from private.historical_rider_promotions_20260915_backup b
    where b."repairKey" = 'HIST-SEASON-REF-2026'
      and b.entity = 'riders_women'
      and b."rowKey" = r.id
  );

do $$
begin
  if exists (
    select 1 from public.riders_men m
    where m."historicalCatalogOnly" = true
      and (
        exists (
          select 1 from public.startlist_riders sr
          join public.races ra on ra.id = sr."raceId"
          where sr."globalRiderId" = m.id
            and ra."year" = extract(year from current_date)::integer
        )
        or exists (
          select 1 from public.race_uci_results res
          join public.races ra on ra.id = res."raceId"
          where res."globalRiderId" = m.id
            and ra."year" = extract(year from current_date)::integer
        )
      )
  ) or exists (
    select 1 from public.riders_women w
    where w."historicalCatalogOnly" = true
      and (
        exists (
          select 1 from public.startlist_riders sr
          join public.races ra on ra.id = sr."raceId"
          where sr."globalRiderId" = w.id
            and ra."year" = extract(year from current_date)::integer
        )
        or exists (
          select 1 from public.race_uci_results res
          join public.races ra on ra.id = res."raceId"
          where res."globalRiderId" = w.id
            and ra."year" = extract(year from current_date)::integer
        )
      )
  ) then
    raise exception 'season_referenced_rider_still_hidden';
  end if;

  if not exists (
    select 1 from public.riders_men
    where id = 'kalejman-quiroga-mateo' and "historicalCatalogOnly" = false
  ) then
    raise exception 'kalejman_promotion_missing';
  end if;
end;
$$;

comment on function private.promote_referenced_rider(text, text) is
  'Hace pública una ficha histórica referenciada por la temporada vigente; acceso exclusivo de los triggers de promoción.';
comment on function private.promote_startlist_referenced_rider() is
  'Promociona la ficha de un corredor que entra en una startlist de la temporada vigente.';
comment on function private.promote_result_referenced_rider() is
  'Promociona la ficha de un corredor que entra en un resultado in-house de la temporada vigente.';

commit;
