-- Consolida Winspace Orange Seal 2025 en la matriz longitudinal de
-- Mayenne Monbana My Pie, confirmada por el anuncio oficial del equipo.
begin;

create table private.repair_winspace_mayenne_20260907_backup (
  entity text not null,
  row_key text not null,
  row_data jsonb not null,
  backed_up_at timestamptz not null default transaction_timestamp(),
  primary key (entity, row_key)
);
alter table private.repair_winspace_mayenne_20260907_backup enable row level security;
revoke all on table private.repair_winspace_mayenne_20260907_backup from public, anon, authenticated;
grant usage on schema private to service_role;
grant select, insert on table private.repair_winspace_mayenne_20260907_backup to service_role;
comment on table private.repair_winspace_mayenne_20260907_backup is
  'Backup recuperable previo al cruce Winspace Orange Seal 2025 con Mayenne Monbana My Pie.';

create temp table _winspace_mayenne_merge (
  source_id text primary key,
  target_id text not null,
  gender text not null check (gender in ('male', 'female')),
  check (source_id <> target_id)
) on commit drop;

insert into _winspace_mayenne_merge (source_id, target_id, gender)
values ('uci-hist-female-2025-20303', 'team_1776715672148_9njdjy', 'female');

do $preflight$
begin
  perform 1
  from public.teams t
  where t.id in (
    'uci-hist-female-2025-20303',
    'team_1776715672148_9njdjy'
  )
  for update;

  if (
    select count(*)
    from _winspace_mayenne_merge m
    join public.teams source
      on source.id = m.source_id
     and source."historicalCatalogOnly" = true
     and source.gender = m.gender
     and source."specialEdition" = false
    join public.teams target
      on target.id = m.target_id
     and target.gender = m.gender
     and target."specialEdition" = false
     and target."teamKind" <> 'selection'
    join private.uci_catalog_team_links source_link
      on source_link.team_id = source.id
     and source_link.season = 2025
     and source_link.profile = '20303'
     and source_link.gender = 'female'
    join private.uci_catalog_team_links target_link
      on target_link.team_id = target.id
     and target_link.season = 2026
     and target_link.profile = '20846'
     and target_link.gender = 'female'
  ) <> 1 then
    raise exception 'Las identidades Winspace o Mayenne cambiaron desde la auditoría';
  end if;

  if exists (
    select 1
    from public.team_seasons source
    join _winspace_mayenne_merge m on m.source_id = source."teamId"
    join public.team_seasons target
      on target."teamId" = m.target_id
     and target.year = source.year
  ) then
    raise exception 'La temporada Winspace colisiona con la matriz de Mayenne';
  end if;
end
$preflight$;

insert into private.repair_winspace_mayenne_20260907_backup (entity, row_key, row_data)
select 'teams', md5(to_jsonb(x)::text), to_jsonb(x)
from public.teams x
where x.id in (select source_id from _winspace_mayenne_merge union select target_id from _winspace_mayenne_merge);

insert into private.repair_winspace_mayenne_20260907_backup (entity, row_key, row_data)
select 'team_seasons', md5(to_jsonb(x)::text), to_jsonb(x)
from public.team_seasons x where x."teamId" in (select source_id from _winspace_mayenne_merge);
insert into private.repair_winspace_mayenne_20260907_backup (entity, row_key, row_data)
select 'uci_catalog_team_links', md5(to_jsonb(x)::text), to_jsonb(x)
from private.uci_catalog_team_links x where x.team_id in (select source_id from _winspace_mayenne_merge);
insert into private.repair_winspace_mayenne_20260907_backup (entity, row_key, row_data)
select 'historical_team_roster_observations', md5(to_jsonb(x)::text), to_jsonb(x)
from private.historical_team_roster_observations x where x."teamId" in (select source_id from _winspace_mayenne_merge);
insert into private.repair_winspace_mayenne_20260907_backup (entity, row_key, row_data)
select 'historical_participation_decisions', md5(to_jsonb(x)::text), to_jsonb(x)
from private.historical_participation_decisions x where x."teamId" in (select source_id from _winspace_mayenne_merge);
insert into private.repair_winspace_mayenne_20260907_backup (entity, row_key, row_data)
select 'rider_team_affiliations', md5(to_jsonb(x)::text), to_jsonb(x)
from public.rider_team_affiliations x where x."teamId" in (select source_id from _winspace_mayenne_merge);
insert into private.repair_winspace_mayenne_20260907_backup (entity, row_key, row_data)
select 'race_uci_results', md5(to_jsonb(x)::text), to_jsonb(x)
from public.race_uci_results x where x."teamId" in (select source_id from _winspace_mayenne_merge);
insert into private.repair_winspace_mayenne_20260907_backup (entity, row_key, row_data)
select 'startlist_teams', md5(to_jsonb(x)::text), to_jsonb(x)
from public.startlist_teams x where x."teamId" in (select source_id from _winspace_mayenne_merge);
insert into private.repair_winspace_mayenne_20260907_backup (entity, row_key, row_data)
select 'team_link_decisions', md5(to_jsonb(x)::text), to_jsonb(x)
from public.team_link_decisions x where x."teamId" in (select source_id from _winspace_mayenne_merge);
insert into private.repair_winspace_mayenne_20260907_backup (entity, row_key, row_data)
select 'team_name_aliases', md5(to_jsonb(x)::text), to_jsonb(x)
from public.team_name_aliases x where x."teamId" in (select source_id from _winspace_mayenne_merge);
insert into private.repair_winspace_mayenne_20260907_backup (entity, row_key, row_data)
select 'team_season_variants', md5(to_jsonb(x)::text), to_jsonb(x)
from public.team_season_variants x where x."teamId" in (select source_id from _winspace_mayenne_merge);
insert into private.repair_winspace_mayenne_20260907_backup (entity, row_key, row_data)
select 'uci_team_rankings', md5(to_jsonb(x)::text), to_jsonb(x)
from public.uci_team_rankings x where x."teamId" in (select source_id from _winspace_mayenne_merge);
insert into private.repair_winspace_mayenne_20260907_backup (entity, row_key, row_data)
select 'uci_catalog_baselines', md5(to_jsonb(x)::text), to_jsonb(x)
from private.uci_catalog_baselines x where x.team_id in (select source_id from _winspace_mayenne_merge);
insert into private.repair_winspace_mayenne_20260907_backup (entity, row_key, row_data)
select 'team_development_links', md5(to_jsonb(x)::text), to_jsonb(x)
from public.team_development_links x
where x."mainTeamId" in (select source_id from _winspace_mayenne_merge)
   or x."developmentTeamId" in (select source_id from _winspace_mayenne_merge);
insert into private.repair_winspace_mayenne_20260907_backup (entity, row_key, row_data)
select 'teams_parent', md5(to_jsonb(x)::text), to_jsonb(x)
from public.teams x where x."parentTeamId" in (select source_id from _winspace_mayenne_merge);
insert into private.repair_winspace_mayenne_20260907_backup (entity, row_key, row_data)
select 'riders_men', md5(to_jsonb(x)::text), to_jsonb(x)
from public.riders_men x where x."currentTeamId" in (select source_id from _winspace_mayenne_merge);
insert into private.repair_winspace_mayenne_20260907_backup (entity, row_key, row_data)
select 'riders_women', md5(to_jsonb(x)::text), to_jsonb(x)
from public.riders_women x where x."currentTeamId" in (select source_id from _winspace_mayenne_merge);
insert into private.repair_winspace_mayenne_20260907_backup (entity, row_key, row_data)
select 'rider_transfers', md5(to_jsonb(x)::text), to_jsonb(x)
from public.rider_transfers x
where x."fromTeamId" in (select source_id from _winspace_mayenne_merge)
   or x."toTeamId" in (select source_id from _winspace_mayenne_merge);

update public.team_seasons x set "teamId" = m.target_id, "updatedAt" = transaction_timestamp()
from _winspace_mayenne_merge m where x."teamId" = m.source_id;
update private.uci_catalog_team_links x set team_id = m.target_id, reviewed_at = transaction_timestamp()
from _winspace_mayenne_merge m where x.team_id = m.source_id;
update private.historical_team_roster_observations x set "teamId" = m.target_id
from _winspace_mayenne_merge m where x."teamId" = m.source_id;
update private.historical_participation_decisions x set "teamId" = m.target_id
from _winspace_mayenne_merge m where x."teamId" = m.source_id;
update public.rider_team_affiliations x
set "teamId" = m.target_id,
    id = 'hist_' || md5(concat_ws('|', x."riderGender", x."riderId", m.target_id, x.year, x."dateFrom", x."dateTo", x."sourceUrl")),
    "updatedAt" = transaction_timestamp()
from _winspace_mayenne_merge m where x."teamId" = m.source_id;
update public.race_uci_results x set "teamId" = m.target_id
from _winspace_mayenne_merge m where x."teamId" = m.source_id;
update public.startlist_teams x set "teamId" = m.target_id
from _winspace_mayenne_merge m where x."teamId" = m.source_id;
update public.team_link_decisions x set "teamId" = m.target_id
from _winspace_mayenne_merge m where x."teamId" = m.source_id;
update public.team_name_aliases x set "teamId" = m.target_id
from _winspace_mayenne_merge m where x."teamId" = m.source_id;
update public.team_season_variants x set "teamId" = m.target_id, "updatedAt" = transaction_timestamp()
from _winspace_mayenne_merge m where x."teamId" = m.source_id;
update public.uci_team_rankings x set "teamId" = m.target_id
from _winspace_mayenne_merge m where x."teamId" = m.source_id;
update private.uci_catalog_baselines x set team_id = m.target_id
from _winspace_mayenne_merge m where x.team_id = m.source_id;
update public.team_development_links x set "mainTeamId" = m.target_id
from _winspace_mayenne_merge m where x."mainTeamId" = m.source_id;
update public.team_development_links x set "developmentTeamId" = m.target_id
from _winspace_mayenne_merge m where x."developmentTeamId" = m.source_id;
update public.teams x set "parentTeamId" = m.target_id, "updatedAt" = transaction_timestamp()
from _winspace_mayenne_merge m where x."parentTeamId" = m.source_id;
update public.riders_men x set "currentTeamId" = m.target_id, "updatedAt" = transaction_timestamp()
from _winspace_mayenne_merge m where x."currentTeamId" = m.source_id;
update public.riders_women x set "currentTeamId" = m.target_id, "updatedAt" = transaction_timestamp()
from _winspace_mayenne_merge m where x."currentTeamId" = m.source_id;
update public.rider_transfers x set "fromTeamId" = m.target_id
from _winspace_mayenne_merge m where x."fromTeamId" = m.source_id;
update public.rider_transfers x set "toTeamId" = m.target_id
from _winspace_mayenne_merge m where x."toTeamId" = m.source_id;

select set_config('app.historical_catalog', 'on', true);
with latest as (
  select distinct on (s."teamId")
    s."teamId", s.name, s.category, s."headerBg", s."headerText",
    s."badgeTorsoCenter", s."badgeTorsoSides", s."badgeInnerCircle",
    s."badgeShorts", s."badgeVisible"
  from public.team_seasons s
  where s."teamId" = 'team_1776715672148_9njdjy'
  order by s."teamId", s.year desc
), stats as (
  select s."teamId", min(s.year) as first_season,
    string_agg(distinct btrim(s.name), E'\n' order by btrim(s.name))
      filter (where btrim(s.name) <> '') as aliases
  from public.team_seasons s
  where s."teamId" = 'team_1776715672148_9njdjy'
  group by s."teamId"
)
update public.teams t
set "firstSeason" = least(coalesce(t."firstSeason", stats.first_season), stats.first_season),
    "nameAliases" = stats.aliases,
    "updatedAt" = transaction_timestamp()
from latest, stats
where t.id = latest."teamId" and stats."teamId" = t.id;

do $verify$
begin
  if exists (
    select 1 from public.team_seasons
    group by "teamId", year having count(*) > 1
  ) or exists (
    select 1 from public.team_seasons s
    join public.teams t on t.id = s."teamId"
    where s.gender is distinct from t.gender
  ) or exists (
    select 1 from private.uci_catalog_team_links l
    left join public.team_seasons s
      on s."teamId" = l.team_id and s.year = l.season
    where s.id is null
       or l.gender is distinct from s.gender
       or l.category is distinct from s.category
  ) then
    raise exception 'El cruce Winspace-Mayenne produjo solapamientos o referencias incompatibles';
  end if;

  if exists (select 1 from public.team_seasons where "teamId" = 'uci-hist-female-2025-20303')
     or exists (select 1 from private.uci_catalog_team_links where team_id = 'uci-hist-female-2025-20303')
     or exists (select 1 from private.historical_team_roster_observations where "teamId" = 'uci-hist-female-2025-20303')
     or exists (select 1 from public.rider_team_affiliations where "teamId" = 'uci-hist-female-2025-20303')
     or exists (select 1 from public.race_uci_results where "teamId" = 'uci-hist-female-2025-20303')
     or exists (select 1 from public.startlist_teams where "teamId" = 'uci-hist-female-2025-20303') then
    raise exception 'Quedan referencias operativas en la identidad histórica Winspace';
  end if;

  if (select count(*) from private.repair_winspace_mayenne_20260907_backup) <> 15 then
    raise exception 'El backup Winspace-Mayenne no contiene las 15 filas previstas';
  end if;
end
$verify$;

commit;

-- Rollback dirigido: restaurar las 15 filas desde row_data dentro de una
-- transacción, empezando por teams y team_seasons.
