-- ═══════════════════════════════════════════════════════════════════
--  RÁNKING UCI DE EQUIPOS EN VIVO
--
--  public.uci_team_rankings deja de ser una copia directa de DataRide y
--  pasa a ser el resultado de combinar, para la temporada publicada:
--
--    1. la última instantánea oficial de la UCI de esa temporada
--       (public.uci_team_ranking_official, la escribe el sincronizador de
--       DataRide cada martes y sustituye todo lo calculado antes);
--    2. los puntos UCI de las clasificaciones oficiales posteriores a esa
--       instantánea, sumados al equipo con el que corría cada corredor el
--       día de la clasificación;
--    3. menos las penalizaciones manuales de los comunicados del jurado
--       técnico (public.uci_ranking_penalties) posteriores a la instantánea.
--
--  La identidad del equipo es public.teams.id, estable entre temporadas:
--  los puntos de la identidad 2026 (19-10 a 31-12-2026) y los de 2027
--  (desde el 1-1-2027) se suman en la misma fila del ránking 2027. El
--  nombre y la categoría salen de la temporada del ránking y, mientras no
--  exista, de la anterior.
--
--  La temporada que alimenta la tabla pública es la que tiene
--  "isPublished" (una sola). Esta migración deja publicada 2026, cuyo
--  ránking final está cerrado: la tabla no cambia hasta activar 2027 con
--  public.admin_publish_uci_ranking_season(2027).
-- ═══════════════════════════════════════════════════════════════════

-- ─── 1. Temporadas del ránking ───────────────────────────────────

create table public.uci_ranking_seasons (
  "seasonYear" smallint primary key,
  "startDate" date not null,
  "endDate" date not null,
  "dataRideSeasonId" integer,
  "isPublished" boolean not null default false,
  "updatedAt" timestamptz not null default now(),
  constraint uci_ranking_seasons_dates_check check ("startDate" < "endDate")
);

create unique index uci_ranking_seasons_published_key
  on public.uci_ranking_seasons ("isPublished")
  where "isPublished";

comment on table public.uci_ranking_seasons is
  'Temporadas del ránking UCI de equipos (fechas locales de DataRide). La fila con isPublished alimenta public.uci_team_rankings.';

insert into public.uci_ranking_seasons
  ("seasonYear", "startDate", "endDate", "dataRideSeasonId", "isPublished")
values
  (2026, '2025-10-20', '2026-10-18', 464, true),
  (2027, '2026-10-19', '2027-10-17', 477, false);

alter table public.uci_ranking_seasons enable row level security;

create policy cc_results_worker_access on public.uci_ranking_seasons
  for all to cc_results_worker using (true) with check (true);

grant select on table public.uci_ranking_seasons to cc_agent, cc_results_worker;
grant insert on table public.uci_ranking_seasons to cc_results_worker;
grant update ("startDate", "endDate", "dataRideSeasonId", "updatedAt")
  on table public.uci_ranking_seasons to cc_results_worker;
grant select, insert, update, delete on table public.uci_ranking_seasons to service_role;

-- ─── 2. Instantáneas oficiales por temporada ─────────────────────

create table public.uci_team_ranking_official (
  "seasonYear" smallint not null
    references public.uci_ranking_seasons("seasonYear") on delete cascade,
  gender text not null,
  rank smallint not null,
  "previousRank" smallint,
  "uciTeamId" bigint not null,
  "teamId" text references public.teams(id) on delete set null,
  "teamCategory" text,
  "sourceName" text not null,
  "displayName" text not null,
  "teamCode" text,
  "countryCode" text,
  points numeric(12,2) not null,
  "sanctionPoints" numeric(12,2),
  "rankingDate" date not null,
  "rankingId" integer not null,
  "momentId" integer not null,
  "disciplineSeasonId" integer not null,
  "sourceUrl" text not null,
  "syncedAt" timestamptz not null default now(),

  constraint uci_team_ranking_official_pkey primary key ("seasonYear", gender, rank),
  constraint uci_team_ranking_official_gender_check check (gender in ('male', 'female')),
  constraint uci_team_ranking_official_rank_check check (rank > 0),
  constraint uci_team_ranking_official_points_check check (points >= 0),
  constraint uci_team_ranking_official_team_key unique ("seasonYear", gender, "uciTeamId")
);

create index uci_team_ranking_official_team_idx
  on public.uci_team_ranking_official ("teamId")
  where "teamId" is not null;

comment on table public.uci_team_ranking_official is
  'Última instantánea oficial (DataRide) del ránking UCI de equipos por temporada y género. momentId 0 = carga provisional de otra fuente.';

comment on column public.uci_team_ranking_official."sanctionPoints" is
  'Puntos de sanción que DataRide declara para el equipo; ya descontados de points.';

-- El ránking final de 2026 que ya estaba en la tabla pública.
insert into public.uci_team_ranking_official (
  "seasonYear", gender, rank, "previousRank", "uciTeamId", "teamId", "teamCategory",
  "sourceName", "displayName", "teamCode", "countryCode", points, "rankingDate",
  "rankingId", "momentId", "disciplineSeasonId", "sourceUrl", "syncedAt"
)
select
  2026, gender, rank, "previousRank", "uciTeamId", "teamId", "teamCategory",
  "sourceName", "displayName", "teamCode", "countryCode", points, "rankingDate",
  "rankingId", "momentId", "disciplineSeasonId", "sourceUrl", "syncedAt"
from public.uci_team_rankings;

alter table public.uci_team_ranking_official enable row level security;

create policy cc_results_worker_access on public.uci_team_ranking_official
  for all to cc_results_worker using (true) with check (true);

grant select, insert, update, delete on table public.uci_team_ranking_official
  to cc_agent, cc_results_worker, service_role;

-- ─── 3. Penalizaciones de los comunicados del jurado ─────────────

create table public.uci_ranking_penalties (
  id uuid primary key default gen_random_uuid(),
  "raceId" text not null references public.races(id) on delete cascade,
  "stageRef" text references public.race_uci_stages(id) on delete set null,
  gender text not null,
  "globalRiderId" text,
  bib text,
  "teamId" text not null references public.teams(id),
  points numeric(10,2) not null,
  "penaltyDate" date not null,
  reason text not null,
  "sourceUrl" text,
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now(),

  constraint uci_ranking_penalties_gender_check check (gender in ('male', 'female')),
  constraint uci_ranking_penalties_points_check check (points > 0),
  constraint uci_ranking_penalties_reason_check check (length(btrim(reason)) > 0)
);

create index uci_ranking_penalties_date_idx
  on public.uci_ranking_penalties (gender, "penaltyDate");
create index uci_ranking_penalties_race_idx
  on public.uci_ranking_penalties ("raceId");

comment on table public.uci_ranking_penalties is
  'Puntos UCI retirados por el jurado técnico (comunicados). Se restan al equipo mientras penaltyDate sea igual o posterior a la última instantánea oficial; después ya los incluye la UCI.';
comment on column public.uci_ranking_penalties."teamId" is
  'Equipo al que se resta: el del corredor en penaltyDate (resuelto al guardar) o el indicado expresamente.';

alter table public.uci_ranking_penalties enable row level security;

create policy "Las penalizaciones UCI son de lectura pública"
  on public.uci_ranking_penalties for select to anon, authenticated using (true);

grant select on table public.uci_ranking_penalties to anon, authenticated, cc_agent;
grant select, insert, update, delete on table public.uci_ranking_penalties to service_role;

-- ─── 4. Columnas nuevas de la tabla pública ──────────────────────

alter table public.uci_team_rankings
  add column "seasonYear" smallint,
  add column "officialPoints" numeric(12,2),
  add column "provisionalPoints" numeric(12,2) not null default 0,
  add column "penaltyPoints" numeric(12,2) not null default 0,
  add column "officialRankingDate" date;

update public.uci_team_rankings
set "seasonYear" = 2026, "officialPoints" = points, "officialRankingDate" = "rankingDate";

comment on table public.uci_team_rankings is
  'Ránking UCI de equipos de la temporada publicada: última instantánea oficial + puntos de clasificaciones oficiales posteriores − penalizaciones posteriores. Lo reescribe private.refresh_uci_team_rankings().';
comment on column public.uci_team_rankings."rankingDate" is
  'Fecha de actualización: la de la instantánea oficial o la de la última clasificación o penalización incluida después.';
comment on column public.uci_team_rankings."officialPoints" is
  'Puntos del equipo en la última instantánea oficial (NULL si aún no figura en ella).';
comment on column public.uci_team_rankings."provisionalPoints" is
  'Puntos de clasificaciones oficiales posteriores a la instantánea oficial.';
comment on column public.uci_team_rankings."penaltyPoints" is
  'Penalizaciones manuales posteriores a la instantánea oficial, ya restadas de points.';
comment on column public.uci_team_rankings."officialRankingDate" is
  'Fecha de la instantánea oficial de la UCI de la que parte la fila.';
comment on column public.uci_team_rankings."uciTeamId" is
  'Equipo en DataRide; negativo para un equipo que aún no figura en la instantánea oficial.';

-- ─── 5. Equipo de un corredor en una fecha ───────────────────────

create or replace function private.uci_ranking_rider_team(
  p_rider text,
  p_gender text,
  p_date date,
  p_race text,
  p_bib text
)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  -- 1. Afiliación del año de la clasificación; las de ventana (stagiaires,
  --    cambios de mitad de temporada) pasan delante de las anuales.
  -- 2. Equipo de la lista de inscritos de la carrera, si es de club. Las
  --    selecciones nacionales nunca puntúan para un equipo.
  select coalesce(
    (
      select f."teamId"
      from public.rider_team_affiliations f
      join public.teams t on t.id = f."teamId"
      where p_rider is not null
        and f."riderId" = p_rider
        and f."riderGender" = p_gender
        and f.year = extract(year from p_date)::integer
        and t."teamKind" = 'club'
        and (t.gender is null or t.gender = p_gender)
        and (f."dateFrom" is null or f."dateFrom" <= p_date)
        and (f."dateTo" is null or f."dateTo" >= p_date)
      order by
        (f."dateFrom" is not null or f."dateTo" is not null) desc,
        f.verified desc,
        f."updatedAt" desc nulls last,
        f.id
      limit 1
    ),
    (
      select st."teamId"
      from public.startlist_riders sr
      join public.startlist_teams st on st.id = sr."teamId"
      join public.teams t on t.id = st."teamId"
      where sr."raceId" = p_race
        and t."teamKind" = 'club'
        and (t.gender is null or t.gender = p_gender)
        and (
          (p_rider is not null and sr."globalRiderId" = p_rider)
          or (p_bib ~ '^[0-9]+$' and sr.dorsal = p_bib::integer)
        )
      order by (sr."globalRiderId" is not distinct from p_rider) desc, sr.id
      limit 1
    )
  );
$$;

-- Un equipo puntúa en una fecha si su temporada de ese año tiene categoría
-- UCI. Sin temporada creada para ese año (equipos de 2027 aún sin alta),
-- vale la del año anterior.
create or replace function private.uci_ranking_team_eligible(p_team text, p_date date)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (
      select ts.category in ('WT', 'PT', 'CT', 'WWT', 'PRW', 'CTW')
      from public.team_seasons ts
      where ts."teamId" = p_team
        and ts.year in (extract(year from p_date)::integer, extract(year from p_date)::integer - 1)
      order by ts.year desc
      limit 1
    ),
    false
  );
$$;

-- ─── 6. Cálculo del ránking de una temporada ─────────────────────

create or replace function private.uci_team_ranking_compute(p_season smallint)
returns table (
  gender text,
  rank smallint,
  "previousRank" smallint,
  "uciTeamId" bigint,
  "teamId" text,
  "teamCategory" text,
  "sourceName" text,
  "displayName" text,
  "teamCode" text,
  "countryCode" text,
  points numeric(12,2),
  "rankingDate" date,
  "rankingId" integer,
  "momentId" integer,
  "disciplineSeasonId" integer,
  "sourceUrl" text,
  "seasonYear" smallint,
  "officialPoints" numeric(12,2),
  "provisionalPoints" numeric(12,2),
  "penaltyPoints" numeric(12,2),
  "officialRankingDate" date
)
language sql
stable
security definer
set search_path = ''
as $$
  with season as (
    select s.* from public.uci_ranking_seasons s where s."seasonYear" = p_season
  ),
  official as (
    select o.* from public.uci_team_ranking_official o where o."seasonYear" = p_season
  ),
  -- Ventana de cada género: desde la fecha de la instantánea oficial (las
  -- clasificaciones de ese día y posteriores no están en ella) hasta el fin
  -- de temporada. Con la instantánea final, la ventana queda cerrada.
  windows as (
    select
      g.gender,
      g."rankingId",
      od.official_date,
      coalesce(od.official_date, s."startDate") as from_date,
      s."endDate" as to_date,
      coalesce(od.official_date >= s."endDate", false) as closed,
      od.moment_id,
      od.source_url,
      s."dataRideSeasonId"
    from (values ('male', 238), ('female', 35)) as g(gender, "rankingId")
    cross join season s
    left join lateral (
      select
        max(o."rankingDate") as official_date,
        max(o."momentId") as moment_id,
        min(o."sourceUrl") as source_url
      from official o
      where o.gender = g.gender
    ) od on true
  ),
  results as (
    select
      rr."globalRiderId" as rider,
      rr.bib,
      rr."uciPoints" as pts,
      s.stage_date,
      s."raceId" as race,
      coalesce(
        ra.gender,
        (
          select sr."riderGender"
          from public.startlist_riders sr
          where sr."raceId" = s."raceId"
            and rr."globalRiderId" is not null
            and sr."globalRiderId" = rr."globalRiderId"
            and sr."riderGender" in ('male', 'female')
          limit 1
        ),
        case
          when exists (select 1 from public.riders_men m where m.id = rr."globalRiderId") then 'male'
          when exists (select 1 from public.riders_women w where w.id = rr."globalRiderId") then 'female'
        end
      ) as gender
    from (
      select
        st.id,
        st."raceId",
        case when st."stageDate" ~ '^\d{4}-\d{2}-\d{2}$' then st."stageDate"::date end as stage_date
      from public.race_uci_stages st
      where st."publicationStatus" = 'official'
    ) s
    join public.races ra on ra.id = s."raceId"
    join public.race_uci_results rr on rr."stageRef" = s.id
    where rr."uciPoints" > 0
      and s.stage_date >= (select min(w.from_date) from windows w where not w.closed)
      and s.stage_date <= (select se."endDate" from season se)
  ),
  attributed as (
    select
      r.gender,
      r.stage_date,
      r.pts,
      private.uci_ranking_rider_team(r.rider, r.gender, r.stage_date, r.race, r.bib) as team
    from results r
    join windows w
      on w.gender = r.gender
     and not w.closed
     and r.stage_date between w.from_date and w.to_date
  ),
  delta as (
    select a.gender, a.team, sum(a.pts) as pts, max(a.stage_date) as last_date
    from attributed a
    where a.team is not null
      and private.uci_ranking_team_eligible(a.team, a.stage_date)
    group by a.gender, a.team
  ),
  penalties as (
    select p.gender, p."teamId" as team, sum(p.points) as pts, max(p."penaltyDate") as last_date
    from public.uci_ranking_penalties p
    join windows w
      on w.gender = p.gender
     and not w.closed
     and p."penaltyDate" between w.from_date and w.to_date
    group by p.gender, p."teamId"
  ),
  adjusted as (
    select x.gender, x.team from delta x
    union
    select y.gender, y.team from penalties y
  ),
  merged as (
    select
      o.gender, o."teamId" as team, o."uciTeamId", o.rank as official_rank,
      o."previousRank" as official_previous, o.points as official_points,
      o."teamCategory", o."sourceName", o."displayName", o."teamCode",
      o."countryCode", o."rankingId", o."momentId", o."disciplineSeasonId",
      o."sourceUrl", true as in_official
    from official o
    union all
    select
      a.gender, a.team, null::bigint, null::smallint, null::smallint, null::numeric,
      null, null, null, null, null, null::integer, null::integer, null::integer,
      null, false
    from adjusted a
    where not exists (
      select 1 from official o where o.gender = a.gender and o."teamId" = a.team
    )
  ),
  decorated as (
    select
      m.*,
      coalesce(d.pts, 0) as provisional,
      coalesce(p.pts, 0) as penalty,
      coalesce(m.official_points, 0) + coalesce(d.pts, 0) - coalesce(p.pts, 0) as total,
      greatest(d.last_date, p.last_date) as last_date,
      ts.name as season_name,
      ts.category as season_category,
      ts."uciCode" as season_code,
      tm.name as team_name,
      upper(nullif(tm."countryCode", '')) as team_country
    from merged m
    left join delta d on d.gender = m.gender and d.team = m.team
    left join penalties p on p.gender = m.gender and p.team = m.team
    left join public.teams tm on tm.id = m.team
    left join lateral (
      select ts.name, ts.category, ts."uciCode"
      from public.team_seasons ts
      where m.team is not null
        and ts."teamId" = m.team
        and ts.year in (p_season, p_season - 1)
      order by ts.year desc
      limit 1
    ) ts on true
  ),
  ranked as (
    select
      d.*,
      row_number() over (
        partition by d.gender
        order by d.total desc, d.official_rank nulls last,
          coalesce(d.season_name, d."displayName", d.team_name, d."sourceName")
      ) as new_rank,
      bool_or(d.provisional <> 0 or d.penalty <> 0) over (partition by d.gender) as gender_adjusted,
      max(d.last_date) over (partition by d.gender) as gender_last_date
    from decorated d
    where d.total > 0
  )
  select
    r.gender,
    r.new_rank::smallint,
    case when r.gender_adjusted then r.official_rank else r.official_previous end,
    coalesce(r."uciTeamId", -((abs(hashtextextended(r.team, 0)) % 1000000000000000) + 1)),
    r.team,
    coalesce(r.season_category, r."teamCategory"),
    coalesce(r."sourceName", r.season_name, r.team_name),
    coalesce(r.season_name, r."displayName", r.team_name, r."sourceName"),
    coalesce(r."teamCode", r.season_code),
    coalesce(r."countryCode", r.team_country),
    round(r.total, 2)::numeric(12,2),
    greatest(w.from_date, r.gender_last_date),
    coalesce(r."rankingId", w."rankingId"),
    coalesce(r."momentId", w.moment_id, 0),
    coalesce(r."disciplineSeasonId", w."dataRideSeasonId", 0),
    coalesce(
      r."sourceUrl",
      w.source_url,
      'https://dataride.uci.ch/iframe/RankingDetails/' || w."rankingId" || '?disciplineId=10'
    ),
    p_season,
    r.official_points::numeric(12,2),
    round(r.provisional, 2)::numeric(12,2),
    round(r.penalty, 2)::numeric(12,2),
    w.official_date
  from ranked r
  join windows w on w.gender = r.gender
  order by r.gender, r.new_rank;
$$;

-- ─── 7. Reescritura de la tabla pública ──────────────────────────

create or replace function private.refresh_uci_team_rankings()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_season smallint;
  v_fresh jsonb;
  v_current jsonb;
  v_changed boolean;
begin
  perform pg_advisory_xact_lock(hashtext('uci_team_rankings_sync'));

  select s."seasonYear" into v_season
  from public.uci_ranking_seasons s
  where s."isPublished";
  if v_season is null then
    return jsonb_build_object('season', null, 'changed', false);
  end if;

  select coalesce(jsonb_agg(to_jsonb(c) order by c.gender, c.rank), '[]'::jsonb)
  into v_fresh
  from private.uci_team_ranking_compute(v_season) c;

  -- Sin filas calculadas (temporada sin instantánea ni resultados), se
  -- conserva la tabla: nunca se publica un ránking vacío.
  if jsonb_array_length(v_fresh) = 0 then
    return jsonb_build_object('season', v_season, 'changed', false, 'empty', true);
  end if;

  select coalesce(jsonb_agg(to_jsonb(c) order by c.gender, c.rank), '[]'::jsonb)
  into v_current
  from (
    select
      t.gender, t.rank, t."previousRank", t."uciTeamId", t."teamId", t."teamCategory",
      t."sourceName", t."displayName", t."teamCode", t."countryCode", t.points,
      t."rankingDate", t."rankingId", t."momentId", t."disciplineSeasonId",
      t."sourceUrl", t."seasonYear", t."officialPoints", t."provisionalPoints",
      t."penaltyPoints", t."officialRankingDate"
    from public.uci_team_rankings t
  ) c;

  v_changed := v_fresh is distinct from v_current;
  if v_changed then
    delete from public.uci_team_rankings;
    insert into public.uci_team_rankings (
      gender, rank, "previousRank", "uciTeamId", "teamId", "teamCategory",
      "sourceName", "displayName", "teamCode", "countryCode", points,
      "rankingDate", "rankingId", "momentId", "disciplineSeasonId", "sourceUrl",
      "seasonYear", "officialPoints", "provisionalPoints", "penaltyPoints",
      "officialRankingDate", "syncedAt"
    )
    select
      x.gender, x.rank, x."previousRank", x."uciTeamId", x."teamId", x."teamCategory",
      x."sourceName", x."displayName", x."teamCode", x."countryCode", x.points,
      x."rankingDate", x."rankingId", x."momentId", x."disciplineSeasonId", x."sourceUrl",
      x."seasonYear", x."officialPoints", x."provisionalPoints", x."penaltyPoints",
      x."officialRankingDate", now()
    from jsonb_populate_recordset(null::public.uci_team_rankings, v_fresh) x;
  end if;

  return jsonb_build_object(
    'season', v_season,
    'changed', v_changed,
    'male', (select count(*) from jsonb_array_elements(v_fresh) e where e->>'gender' = 'male'),
    'female', (select count(*) from jsonb_array_elements(v_fresh) e where e->>'gender' = 'female')
  );
end;
$$;

revoke all on function private.uci_ranking_rider_team(text, text, date, text, text) from public, anon, authenticated;
revoke all on function private.uci_ranking_team_eligible(text, date) from public, anon, authenticated;
revoke all on function private.uci_team_ranking_compute(smallint) from public, anon, authenticated;
revoke all on function private.refresh_uci_team_rankings() from public, anon, authenticated;

-- ─── 8. RPC de operación (panel, agentes y worker del VPS) ───────

create or replace function public.refresh_uci_team_rankings()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.assert_startlist_import_admin();
  return private.refresh_uci_team_rankings();
end;
$$;

comment on function public.refresh_uci_team_rankings() is
  'Recalcula public.uci_team_rankings para la temporada publicada; solo escribe si cambia.';

-- Vista previa de cualquier temporada sin publicarla (pruebas de 2027).
create or replace function public.uci_team_ranking_preview(p_season smallint)
returns setof jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.assert_startlist_import_admin();
  return query
    select to_jsonb(c) from private.uci_team_ranking_compute(p_season) c;
end;
$$;

-- Puntos de la ventana provisional que no llegan a ningún equipo: corredor
-- sin afiliación ni inscripción con equipo de club, o equipo sin categoría UCI.
create or replace function public.uci_team_ranking_unattributed(p_season smallint)
returns table (
  "stageRef" text,
  "raceName" text,
  "stageDate" date,
  gender text,
  "globalRiderId" text,
  "riderDisplay" text,
  bib text,
  "uciPoints" numeric,
  "teamId" text,
  issue text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  perform private.assert_startlist_import_admin();
  return query
  with season as (
    select s.* from public.uci_ranking_seasons s where s."seasonYear" = p_season
  ),
  windows as (
    select
      g.gender,
      coalesce(
        (select max(o."rankingDate") from public.uci_team_ranking_official o
          where o."seasonYear" = p_season and o.gender = g.gender),
        s."startDate"
      ) as from_date,
      s."endDate" as to_date
    from (values ('male'), ('female')) g(gender)
    cross join season s
  ),
  scored as (
    select
      st.id as stage_ref,
      ra.name as race_name,
      st."stageDate"::date as stage_date,
      coalesce(
        ra.gender,
        case
          when exists (select 1 from public.riders_men m where m.id = rr."globalRiderId") then 'male'
          when exists (select 1 from public.riders_women w where w.id = rr."globalRiderId") then 'female'
        end
      ) as rider_gender,
      rr."globalRiderId" as rider,
      rr."riderDisplay" as rider_display,
      rr.bib as rider_bib,
      rr."uciPoints" as points,
      st."raceId" as race
    from public.race_uci_stages st
    join public.races ra on ra.id = st."raceId"
    join public.race_uci_results rr on rr."stageRef" = st.id
    where st."publicationStatus" = 'official'
      and st."stageDate" ~ '^\d{4}-\d{2}-\d{2}$'
      and st."stageDate" >= (select min(w.from_date)::text from windows w)
      and st."stageDate" <= (select max(w.to_date)::text from windows w)
      and rr."uciPoints" > 0
  ),
  checked as (
    select r.*, private.uci_ranking_rider_team(r.rider, r.rider_gender, r.stage_date, r.race, r.rider_bib) as team
    from scored r
    join windows w on w.gender = r.rider_gender
     and r.stage_date between w.from_date and w.to_date
     and w.from_date < w.to_date
  )
  select
    c.stage_ref, c.race_name, c.stage_date, c.rider_gender, c.rider, c.rider_display,
    c.rider_bib, c.points, c.team,
    case when c.team is null then 'sin equipo de club' else 'equipo sin categoría UCI' end
  from checked c
  where c.team is null or not private.uci_ranking_team_eligible(c.team, c.stage_date)
  order by c.stage_date, c.race_name, c.points desc;
end;
$$;

create or replace function public.admin_publish_uci_ranking_season(p_season smallint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.assert_startlist_import_admin();
  if not exists (select 1 from public.uci_ranking_seasons where "seasonYear" = p_season) then
    raise exception 'Temporada de ránking desconocida: %', p_season using errcode = 'P0002';
  end if;
  perform pg_advisory_xact_lock(hashtext('uci_team_rankings_sync'));
  update public.uci_ranking_seasons
  set "isPublished" = false, "updatedAt" = now()
  where "isPublished" and "seasonYear" <> p_season;
  update public.uci_ranking_seasons
  set "isPublished" = true, "updatedAt" = now()
  where "seasonYear" = p_season and not "isPublished";
  return private.refresh_uci_team_rankings();
end;
$$;

create or replace function public.admin_save_uci_ranking_penalty(
  p_race_id text,
  p_points numeric,
  p_reason text,
  p_rider_id text default null,
  p_team_id text default null,
  p_stage_ref text default null,
  p_penalty_date date default null,
  p_bib text default null,
  p_source_url text default null,
  p_gender text default null,
  p_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_race public.races%rowtype;
  v_gender text;
  v_date date;
  v_team text;
  v_id uuid;
begin
  perform private.assert_startlist_import_admin();

  select * into v_race from public.races where id = p_race_id;
  if not found then
    raise exception 'Carrera no encontrada' using errcode = 'P0002';
  end if;
  if p_points is null or p_points <= 0 then
    raise exception 'La penalización debe ser un número de puntos positivo' using errcode = '22023';
  end if;
  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'Indica el motivo del comunicado' using errcode = '22023';
  end if;
  if p_rider_id is null and p_team_id is null and nullif(btrim(p_bib), '') is null then
    raise exception 'Indica el corredor, el dorsal o el equipo' using errcode = '22023';
  end if;

  v_gender := coalesce(
    p_gender,
    v_race.gender,
    case
      when exists (select 1 from public.riders_men where id = p_rider_id) then 'male'
      when exists (select 1 from public.riders_women where id = p_rider_id) then 'female'
    end,
    (select t.gender from public.teams t where t.id = p_team_id)
  );
  if v_gender is null or v_gender not in ('male', 'female') then
    raise exception 'No se pudo determinar el género del ránking' using errcode = '22023';
  end if;
  if p_rider_id is not null
     and ((v_gender = 'male' and not exists (select 1 from public.riders_men where id = p_rider_id))
       or (v_gender = 'female' and not exists (select 1 from public.riders_women where id = p_rider_id))) then
    raise exception 'Corredor no encontrado' using errcode = 'P0002';
  end if;

  if p_stage_ref is not null then
    select st."stageDate"::date into v_date
    from public.race_uci_stages st
    where st.id = p_stage_ref and st."raceId" = p_race_id;
    if not found then
      raise exception 'La clasificación no pertenece a la carrera' using errcode = '22023';
    end if;
  end if;
  v_date := coalesce(p_penalty_date, v_date);
  if v_date is null then
    raise exception 'Indica la clasificación o la fecha de la penalización' using errcode = '22023';
  end if;

  v_team := coalesce(
    p_team_id,
    private.uci_ranking_rider_team(p_rider_id, v_gender, v_date, p_race_id, nullif(btrim(p_bib), ''))
  );
  if v_team is null then
    raise exception 'No se pudo resolver el equipo del corredor: indica el equipo' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.teams t
    where t.id = v_team and t."teamKind" = 'club' and (t.gender is null or t.gender = v_gender)
  ) then
    raise exception 'El equipo no es un equipo de club de ese género' using errcode = '22023';
  end if;

  if p_id is null then
    insert into public.uci_ranking_penalties (
      "raceId", "stageRef", gender, "globalRiderId", bib, "teamId", points,
      "penaltyDate", reason, "sourceUrl"
    ) values (
      p_race_id, p_stage_ref, v_gender, p_rider_id, nullif(btrim(p_bib), ''), v_team, p_points,
      v_date, btrim(p_reason), nullif(btrim(p_source_url), '')
    )
    returning id into v_id;
  else
    update public.uci_ranking_penalties set
      "raceId" = p_race_id,
      "stageRef" = p_stage_ref,
      gender = v_gender,
      "globalRiderId" = p_rider_id,
      bib = nullif(btrim(p_bib), ''),
      "teamId" = v_team,
      points = p_points,
      "penaltyDate" = v_date,
      reason = btrim(p_reason),
      "sourceUrl" = nullif(btrim(p_source_url), ''),
      "updatedAt" = now()
    where id = p_id
    returning id into v_id;
    if v_id is null then
      raise exception 'Penalización no encontrada' using errcode = 'P0002';
    end if;
  end if;

  return jsonb_build_object(
    'id', v_id,
    'teamId', v_team,
    'gender', v_gender,
    'penaltyDate', v_date,
    'ranking', private.refresh_uci_team_rankings()
  );
end;
$$;

create or replace function public.admin_delete_uci_ranking_penalty(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.assert_startlist_import_admin();
  delete from public.uci_ranking_penalties where id = p_id;
  if not found then
    raise exception 'Penalización no encontrada' using errcode = 'P0002';
  end if;
  return jsonb_build_object('id', p_id, 'ranking', private.refresh_uci_team_rankings());
end;
$$;

revoke all on function public.refresh_uci_team_rankings() from public, anon;
revoke all on function public.uci_team_ranking_preview(smallint) from public, anon;
revoke all on function public.uci_team_ranking_unattributed(smallint) from public, anon;
revoke all on function public.admin_publish_uci_ranking_season(smallint) from public, anon;
revoke all on function public.admin_save_uci_ranking_penalty(text, numeric, text, text, text, text, date, text, text, text, uuid) from public, anon;
revoke all on function public.admin_delete_uci_ranking_penalty(uuid) from public, anon;

grant execute on function public.refresh_uci_team_rankings()
  to authenticated, cc_agent, cc_results_worker, service_role;
grant execute on function public.uci_team_ranking_preview(smallint)
  to authenticated, cc_agent, service_role;
grant execute on function public.uci_team_ranking_unattributed(smallint)
  to authenticated, cc_agent, service_role;
grant execute on function public.admin_publish_uci_ranking_season(smallint)
  to authenticated, cc_agent, service_role;
grant execute on function public.admin_save_uci_ranking_penalty(text, numeric, text, text, text, text, date, text, text, text, uuid)
  to authenticated, cc_agent, service_role;
grant execute on function public.admin_delete_uci_ranking_penalty(uuid)
  to authenticated, cc_agent, service_role;
