-- ═══════════════════════════════════════════════════════════════════
--  PENALIZACIONES UCI POR CORREDOR Y CLASIFICACIÓN
--
--  Una penalización de un comunicado del jurado es de un corredor en una
--  clasificación de etapa o de una clásica, no de un equipo: así se podrá
--  mostrar junto al resultado. El equipo al que se resta se resuelve en cada
--  recálculo con el corredor y la fecha, igual que sus puntos.
--
--  La clasificación se identifica por carrera y número de etapa (NULL en una
--  clásica), que sobreviven a la sustitución de una clasificación
--  provisional por la oficial; "stageRef" queda como referencia informativa.
--  La tabla está vacía al aplicar esta migración.
-- ═══════════════════════════════════════════════════════════════════

drop function public.admin_save_uci_ranking_penalty(text, numeric, text, text, text, text, date, text, text, text, uuid);

alter table public.uci_ranking_penalties
  drop column "teamId",
  add column "stageNumber" smallint,
  alter column "globalRiderId" set not null;

alter table public.uci_ranking_penalties
  add constraint uci_ranking_penalties_stage_number_check
    check ("stageNumber" is null or "stageNumber" >= 0);

create index uci_ranking_penalties_rider_idx
  on public.uci_ranking_penalties ("globalRiderId");

comment on table public.uci_ranking_penalties is
  'Puntos UCI retirados por el jurado técnico a un corredor en una clasificación de etapa ("stageNumber") o de una clásica ("stageNumber" NULL). Se restan del equipo del corredor en esa fecha mientras penaltyDate sea igual o posterior a la última instantánea oficial; después ya los incluye la UCI.';
comment on column public.uci_ranking_penalties."stageNumber" is
  'Etapa de la clasificación penalizada; NULL en una clásica.';
comment on column public.uci_ranking_penalties."stageRef" is
  'Clasificación en race_uci_stages al guardar (informativa: una recarga puede sustituirla).';
comment on column public.uci_ranking_penalties."penaltyDate" is
  'Fecha de la clasificación penalizada.';

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
  -- Cada penalización es de un corredor en una clasificación; se resta al
  -- equipo con el que corría ese día, resuelto como sus puntos.
  penalties as (
    select x.gender, x.team, sum(x.points) as pts, max(x."penaltyDate") as last_date
    from (
      select
        p.gender,
        p.points,
        p."penaltyDate",
        private.uci_ranking_rider_team(p."globalRiderId", p.gender, p."penaltyDate", p."raceId", p.bib) as team
      from public.uci_ranking_penalties p
      join windows w
        on w.gender = p.gender
       and not w.closed
       and p."penaltyDate" between w.from_date and w.to_date
    ) x
    where x.team is not null
      and private.uci_ranking_team_eligible(x.team, x."penaltyDate")
    group by x.gender, x.team
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

create function public.admin_save_uci_ranking_penalty(
  p_race_id text,
  p_rider_id text,
  p_points numeric,
  p_reason text,
  p_stage_number integer default null,
  p_source_url text default null,
  p_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_race public.races%rowtype;
  v_stage public.race_uci_stages%rowtype;
  v_gender text;
  v_bib text;
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

  -- Clasificación: la de la etapa en una vuelta, la final en una clásica.
  if v_race."raceFormat" = 'one_day' then
    if p_stage_number is not null then
      raise exception 'Una clásica no lleva número de etapa' using errcode = '22023';
    end if;
    select * into v_stage
    from public.race_uci_stages st
    where st."raceId" = p_race_id and st."classKind" = 'gc'
    order by (st."publicationStatus" = 'official') desc, st."updatedAt" desc nulls last
    limit 1;
  else
    if p_stage_number is null then
      raise exception 'Indica la etapa de la clasificación penalizada' using errcode = '22023';
    end if;
    select * into v_stage
    from public.race_uci_stages st
    where st."raceId" = p_race_id and st."classKind" = 'stage'
      and st."stageNumber" = p_stage_number
    order by (st."publicationStatus" = 'official') desc, st."updatedAt" desc nulls last
    limit 1;
  end if;
  if not found or v_stage."stageDate" !~ '^\d{4}-\d{2}-\d{2}$' then
    raise exception 'No hay clasificación cargada para esa etapa o clásica' using errcode = 'P0002';
  end if;

  v_gender := coalesce(
    v_race.gender,
    case
      when exists (select 1 from public.riders_men where id = p_rider_id) then 'male'
      when exists (select 1 from public.riders_women where id = p_rider_id) then 'female'
    end
  );
  if v_gender is null
     or (v_gender = 'male' and not exists (select 1 from public.riders_men where id = p_rider_id))
     or (v_gender = 'female' and not exists (select 1 from public.riders_women where id = p_rider_id)) then
    raise exception 'Corredor no encontrado' using errcode = 'P0002';
  end if;

  select coalesce(
    (select rr.bib from public.race_uci_results rr
      where rr."stageRef" = v_stage.id and rr."globalRiderId" = p_rider_id limit 1),
    (select sr.dorsal::text from public.startlist_riders sr
      where sr."raceId" = p_race_id and sr."globalRiderId" = p_rider_id and sr.dorsal > 0 limit 1)
  ) into v_bib;
  if v_bib is null
     and not exists (select 1 from public.race_uci_results rr
       where rr."stageRef" = v_stage.id and rr."globalRiderId" = p_rider_id)
     and not exists (select 1 from public.startlist_riders sr
       where sr."raceId" = p_race_id and sr."globalRiderId" = p_rider_id) then
    raise exception 'El corredor no figura en la clasificación ni en los inscritos' using errcode = '22023';
  end if;

  if p_id is null then
    insert into public.uci_ranking_penalties (
      "raceId", "stageNumber", "stageRef", gender, "globalRiderId", bib, points,
      "penaltyDate", reason, "sourceUrl"
    ) values (
      p_race_id, p_stage_number, v_stage.id, v_gender, p_rider_id, v_bib, p_points,
      v_stage."stageDate"::date, btrim(p_reason), nullif(btrim(p_source_url), '')
    )
    returning id into v_id;
  else
    update public.uci_ranking_penalties set
      "raceId" = p_race_id,
      "stageNumber" = p_stage_number,
      "stageRef" = v_stage.id,
      gender = v_gender,
      "globalRiderId" = p_rider_id,
      bib = v_bib,
      points = p_points,
      "penaltyDate" = v_stage."stageDate"::date,
      reason = btrim(p_reason),
      "sourceUrl" = nullif(btrim(p_source_url), ''),
      "updatedAt" = now()
    where id = p_id
    returning id into v_id;
    if v_id is null then
      raise exception 'Penalización no encontrada' using errcode = 'P0002';
    end if;
  end if;

  v_team := private.uci_ranking_rider_team(p_rider_id, v_gender, v_stage."stageDate"::date, p_race_id, v_bib);

  return jsonb_build_object(
    'id', v_id,
    'stageRef', v_stage.id,
    'penaltyDate', v_stage."stageDate"::date,
    'gender', v_gender,
    'teamId', v_team,
    'teamCounts', v_team is not null
      and private.uci_ranking_team_eligible(v_team, v_stage."stageDate"::date),
    'ranking', private.refresh_uci_team_rankings()
  );
end;
$$;

revoke all on function private.uci_team_ranking_compute(smallint) from public, anon, authenticated;
revoke all on function public.admin_save_uci_ranking_penalty(text, text, numeric, text, integer, text, uuid) from public, anon;
grant execute on function public.admin_save_uci_ranking_penalty(text, text, numeric, text, integer, text, uuid)
  to authenticated, cc_agent, service_role;
