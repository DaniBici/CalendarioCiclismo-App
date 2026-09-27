-- Repara tres hallazgos dirigidos del catálogo histórico de corredores:
-- promueve dos fichas activas en 2026, conserva 14 perfiles UCI alternativos
-- y consolida como regular la observación duplicada de Mylène de Zoete.
begin;

create table private.historical_rider_repairs_20260907_backup (
  "repairKey" text not null,
  entity text not null,
  "rowKey" text not null,
  before jsonb not null,
  "backedUpAt" timestamptz not null default clock_timestamp(),
  primary key ("repairKey", entity, "rowKey")
);

revoke all on private.historical_rider_repairs_20260907_backup
  from public, anon, authenticated, service_role;
grant select on private.historical_rider_repairs_20260907_backup to service_role;

create table private.rider_uci_profile_aliases (
  "riderGender" text not null check ("riderGender" in ('male', 'female')),
  "uciProfileId" text not null check ("uciProfileId" ~ '^[0-9]{1,10}$'),
  "riderId" text not null,
  "canonicalUciProfileId" text not null check ("canonicalUciProfileId" ~ '^[0-9]{1,10}$'),
  years integer[] not null check (cardinality(years) > 0),
  evidence jsonb not null check (jsonb_typeof(evidence) = 'array' and jsonb_array_length(evidence) > 0),
  source text not null default 'historical_uci_roster',
  "verifiedAt" timestamptz not null,
  "createdAt" timestamptz not null default clock_timestamp(),
  "updatedAt" timestamptz not null default clock_timestamp(),
  primary key ("riderGender", "uciProfileId"),
  check ("uciProfileId" <> "canonicalUciProfileId")
);

create index rider_uci_profile_aliases_rider
  on private.rider_uci_profile_aliases ("riderGender", "riderId");

revoke all on private.rider_uci_profile_aliases
  from public, anon, authenticated, service_role;
grant select on private.rider_uci_profile_aliases to service_role;

do $$
declare
  v_aliases integer;
begin
  if (select count(*) from public.riders_men
      where id in ('marchuk-dzianis', 'vink-michael-william')
        and "historicalCatalogOnly" = true
        and "currentTeamId" is not null) <> 2 then
    raise exception 'historical_rider_promotion_precondition_changed';
  end if;

  if (select count(*) from private.historical_team_roster_observations
      where year = 2020 and gender = 'female'
        and "teamId" = 'team_1776714655588_6ae9cr'
        and "riderId" = 'de-zoete-mylene'
        and "uciTeamProfileId" = '14187'
        and "uciRiderProfileId" = '155099'
        and "observationType" in ('regular', 'trainee')) <> 2 then
    raise exception 'de_zoete_observation_precondition_changed';
  end if;

  with multi_profile_riders as (
    select gender, "riderId"
    from private.historical_team_roster_observations
    group by gender, "riderId"
    having count(distinct "uciRiderProfileId") > 1
  ), riders as (
    select 'male'::text as gender, id, "uciProfileId" from public.riders_men
    union all
    select 'female', id, "uciProfileId" from public.riders_women
  ), aliases as (
    select distinct o.gender, o."riderId", o."uciRiderProfileId", r."uciProfileId"
    from private.historical_team_roster_observations o
    join multi_profile_riders m on m.gender = o.gender and m."riderId" = o."riderId"
    join riders r on r.gender = o.gender and r.id = o."riderId"
    where o."uciRiderProfileId" <> r."uciProfileId"
  )
  select count(*) into v_aliases from aliases;
  if v_aliases <> 14 then
    raise exception 'historical_rider_alias_precondition_changed: %', v_aliases;
  end if;

  if exists (
    with multi_profile_riders as (
      select gender, "riderId"
      from private.historical_team_roster_observations
      group by gender, "riderId"
      having count(distinct "uciRiderProfileId") > 1
    ), riders as (
      select 'male'::text as gender, id, "uciProfileId" from public.riders_men
      union all
      select 'female', id, "uciProfileId" from public.riders_women
    ), aliases as (
      select distinct o.gender, o."riderId", o."uciRiderProfileId"
      from private.historical_team_roster_observations o
      join multi_profile_riders m on m.gender = o.gender and m."riderId" = o."riderId"
      join riders r on r.gender = o.gender and r.id = o."riderId"
      where o."uciRiderProfileId" <> r."uciProfileId"
    )
    select 1 from aliases a
    join riders r on r."uciProfileId" = a."uciRiderProfileId"
    where r.id <> a."riderId" or r.gender <> a.gender
  ) then
    raise exception 'historical_rider_alias_collision';
  end if;
end;
$$;

insert into private.historical_rider_repairs_20260907_backup
  ("repairKey", entity, "rowKey", before)
select 'HIST-PROMOTE-2', 'riders_men', r.id, to_jsonb(r)
from public.riders_men r
where r.id in ('marchuk-dzianis', 'vink-michael-william');

insert into private.historical_rider_repairs_20260907_backup
  ("repairKey", entity, "rowKey", before)
select 'HIST-DUAL-TYPE-1', 'historical_team_roster_observations',
  concat_ws(':', o.year, o."uciTeamProfileId", o."uciRiderProfileId", o."observationType"),
  to_jsonb(o)
from private.historical_team_roster_observations o
where o.year = 2020 and o.gender = 'female'
  and o."teamId" = 'team_1776714655588_6ae9cr'
  and o."riderId" = 'de-zoete-mylene'
  and o."uciTeamProfileId" = '14187'
  and o."uciRiderProfileId" = '155099'
  and o."observationType" = 'trainee';

with multi_profile_riders as (
  select gender, "riderId"
  from private.historical_team_roster_observations
  group by gender, "riderId"
  having count(distinct "uciRiderProfileId") > 1
), riders as (
  select 'male'::text as gender, id, "uciProfileId" from public.riders_men
  union all
  select 'female', id, "uciProfileId" from public.riders_women
), alias_evidence as (
  select
    o.gender,
    o."riderId",
    o."uciRiderProfileId" as alias_profile,
    r."uciProfileId" as canonical_profile,
    array_agg(distinct o.year order by o.year) as years,
    jsonb_agg(
      jsonb_build_object(
        'year', o.year,
        'teamProfileId', o."uciTeamProfileId",
        'sourceUrl', o."sourceUrl",
        'sourceHash', o."sourceHash",
        'observedAt', o."observedAt",
        'batchId', o."batchId"
      ) order by o.year, o."uciTeamProfileId"
    ) as evidence,
    max(o."observedAt") as verified_at
  from private.historical_team_roster_observations o
  join multi_profile_riders m on m.gender = o.gender and m."riderId" = o."riderId"
  join riders r on r.gender = o.gender and r.id = o."riderId"
  where o."uciRiderProfileId" <> r."uciProfileId"
  group by o.gender, o."riderId", o."uciRiderProfileId", r."uciProfileId"
)
insert into private.rider_uci_profile_aliases
  ("riderGender", "uciProfileId", "riderId", "canonicalUciProfileId", years, evidence, "verifiedAt")
select gender, alias_profile, "riderId", canonical_profile, years, evidence, verified_at
from alias_evidence;

create or replace function private.resolve_rider_uci_profile(
  p_gender text,
  p_profile text
) returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_rider_id text;
  v_matches integer;
begin
  if p_gender not in ('male', 'female') or p_profile !~ '^[0-9]{1,10}$' then
    raise exception 'invalid_rider_uci_profile_lookup' using errcode = '22023';
  end if;

  with candidates as (
    select m.id
    from public.riders_men m
    where p_gender = 'male' and m."uciProfileId" = p_profile
    union
    select w.id
    from public.riders_women w
    where p_gender = 'female' and w."uciProfileId" = p_profile
    union
    select a."riderId"
    from private.rider_uci_profile_aliases a
    where a."riderGender" = p_gender and a."uciProfileId" = p_profile
  )
  select count(*), min(id) into v_matches, v_rider_id from candidates;

  if v_matches > 1 then
    raise exception 'ambiguous_rider_uci_profile_lookup';
  end if;
  return v_rider_id;
end;
$$;

revoke all on function private.resolve_rider_uci_profile(text, text)
  from public, anon, authenticated, service_role;
grant execute on function private.resolve_rider_uci_profile(text, text) to service_role;

create or replace function private.promote_current_historical_rider()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.year = extract(year from current_date)::integer
     and new."affiliationType" = 'regular' then
    if new."riderGender" = 'male' then
      update public.riders_men
      set "historicalCatalogOnly" = false, "updatedAt" = clock_timestamp()
      where id = new."riderId" and "historicalCatalogOnly" = true;
    elsif new."riderGender" = 'female' then
      update public.riders_women
      set "historicalCatalogOnly" = false, "updatedAt" = clock_timestamp()
      where id = new."riderId" and "historicalCatalogOnly" = true;
    end if;
  end if;
  return new;
end;
$$;

revoke all on function private.promote_current_historical_rider()
  from public, anon, authenticated, service_role;

create trigger promote_current_historical_rider
  after insert or update of "riderId", "riderGender", year, "affiliationType"
  on public.rider_team_affiliations
  for each row execute function private.promote_current_historical_rider();

update public.riders_men
set "historicalCatalogOnly" = false, "updatedAt" = clock_timestamp()
where id in ('marchuk-dzianis', 'vink-michael-william')
  and "historicalCatalogOnly" = true
  and "currentTeamId" is not null;

delete from private.historical_team_roster_observations
where year = 2020 and gender = 'female'
  and "teamId" = 'team_1776714655588_6ae9cr'
  and "riderId" = 'de-zoete-mylene'
  and "uciTeamProfileId" = '14187'
  and "uciRiderProfileId" = '155099'
  and "observationType" = 'trainee';

do $$
begin
  if (select count(*) from private.historical_rider_repairs_20260907_backup) <> 3
     or (select count(*) from private.rider_uci_profile_aliases) <> 14
     or (select count(*) from public.riders_men
         where id in ('marchuk-dzianis', 'vink-michael-william')
           and "historicalCatalogOnly" = false
           and "currentTeamId" is not null) <> 2
     or (select count(*) from private.historical_team_roster_observations
         where year = 2020 and gender = 'female'
           and "teamId" = 'team_1776714655588_6ae9cr'
           and "riderId" = 'de-zoete-mylene'
           and "uciTeamProfileId" = '14187'
           and "uciRiderProfileId" = '155099'
           and "observationType" = 'regular') <> 1
     or exists (
       select 1 from private.historical_team_roster_observations
       where year = 2020 and gender = 'female'
         and "teamId" = 'team_1776714655588_6ae9cr'
         and "riderId" = 'de-zoete-mylene'
         and "uciTeamProfileId" = '14187'
         and "uciRiderProfileId" = '155099'
         and "observationType" = 'trainee'
     ) then
    raise exception 'historical_rider_pending_items_verification_failed';
  end if;
end;
$$;

comment on table private.rider_uci_profile_aliases is
  'Perfiles web UCI alternativos verificados que resuelven a una ficha canónica sin sobrescribir uciProfileId.';
comment on function private.resolve_rider_uci_profile(text, text) is
  'Resuelve un perfil web UCI canónico o alternativo a una ficha por género; acceso exclusivo de service_role.';
comment on function private.promote_current_historical_rider() is
  'Hace pública una ficha histórica cuando recibe una afiliación regular del año vigente, sin modificar currentTeamId.';

commit;
