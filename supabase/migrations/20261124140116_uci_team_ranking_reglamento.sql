-- ═══════════════════════════════════════════════════════════════════
--  RÁNKING UCI DE EQUIPOS: REGLAMENTO 2.10.004 TER Y 2.10.014
--
--  1. Tope: suman los 20 mejores corredores de cada equipo (hombres) y las
--     8 mejores (mujeres). Los puntos de un corredor para un equipo son los
--     que logró mientras corría para él; al cambiar de equipo o terminar
--     contrato, los anteriores siguen siendo del equipo anterior.
--     El cálculo propio aplica el tope sobre toda la temporada y suma a la
--     base oficial de cada equipo la diferencia entre el total propio de hoy
--     y el total propio en la fecha de esa base (para un equipo que nunca ha
--     figurado, la de la última publicación del género).
--  2. Stagiaires: sus puntos son de su equipo habitual, nunca del anfitrión.
--  3. Licencia del año: desde el 1 de enero, un equipo solo figura si tiene
--     temporada con categoría UCI en el año de la temporada del ránking; de
--     octubre a diciembre basta la del año anterior. Un equipo que continúa y
--     aún no tiene su temporada creada reaparece con todos sus puntos al
--     crearla (la UCI hizo lo mismo en enero de 2025).
--  4. Último dato oficial por equipo: la UCI vacía el ránking a principios
--     de enero y repone los equipos según los registra. Cada equipo conserva
--     su última fila oficial de la temporada hasta que vuelve a aparecer, y
--     su parte provisional se cuenta desde la fecha de esa fila.
-- ═══════════════════════════════════════════════════════════════════

alter table public.uci_team_ranking_official
  drop constraint uci_team_ranking_official_pkey,
  drop constraint uci_team_ranking_official_team_key;
alter table public.uci_team_ranking_official
  add constraint uci_team_ranking_official_pkey primary key ("seasonYear", gender, "uciTeamId");

comment on table public.uci_team_ranking_official is
  'Última fila oficial (DataRide) de cada equipo en el ránking UCI de equipos por temporada y género. Un equipo ausente de la última publicación conserva su fila anterior ("rankingDate" = fecha en que se vio). momentId 0 = carga provisional de otra fuente.';
comment on column public.uci_team_ranking_official.rank is
  'Puesto en la publicación de "rankingDate"; las filas de fechas distintas no forman un orden.';

-- ─── Equipo de un corredor en una fecha (sin stagiaires) ─────────

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
  -- 1. Afiliación habitual del año de la clasificación; las de ventana
  --    (cambios de mitad de temporada) pasan delante de las anuales. Las
  --    de stagiaire no cuentan: sus puntos son del equipo habitual.
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
        and f."affiliationType" <> 'trainee'
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

-- ─── Cálculo del ránking de una temporada ────────────────────────

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
  -- Año cuya licencia exige el ránking: el de hoy, sin pasar del de la
  -- temporada (de octubre a diciembre, el anterior).
  ref as (
    select least(extract(year from (now() at time zone 'Europe/Madrid'))::integer, p_season::integer) as ref_year
  ),
  official as (
    select o.* from public.uci_team_ranking_official o where o."seasonYear" = p_season
  ),
  windows as (
    select
      g.gender,
      g."rankingId",
      g.top_n,
      od.official_date,
      s."startDate" as from_date,
      s."endDate" as to_date,
      coalesce(od.official_date >= s."endDate", false) as closed,
      od.moment_id,
      (
        select o."sourceUrl" from official o
        where o.gender = g.gender
        order by o."rankingDate" desc, o.rank
        limit 1
      ) as source_url,
      s."dataRideSeasonId"
    from (values ('male', 238, 20), ('female', 35, 8)) as g(gender, "rankingId", top_n)
    cross join season s
    left join lateral (
      select max(o."rankingDate") as official_date, max(o."momentId") as moment_id
      from official o
      where o.gender = g.gender
    ) od on true
  ),
  results as (
    select
      coalesce(rr."globalRiderId", 'bib:' || s."raceId" || ':' || coalesce(rr.bib, rr.id::text)) as rider_key,
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
        and st."stageDate" >= (select se."startDate"::text from season se)
        and st."stageDate" <= (select se."endDate"::text from season se)
    ) s
    join public.races ra on ra.id = s."raceId"
    join public.race_uci_results rr on rr."stageRef" = s.id
    where rr."uciPoints" > 0
      and exists (select 1 from windows w where not w.closed)
  ),
  -- Aportación de cada corredor a cada equipo: puntos de clasificaciones y,
  -- en negativo, penalizaciones, con el equipo con el que corría ese día.
  contributions as (
    select a.gender, a.team, a.rider_key, a.stage_date, a.pts, 0::numeric as penalty
    from (
      select
        r.gender, r.rider_key, r.stage_date, r.pts,
        private.uci_ranking_rider_team(r.rider, r.gender, r.stage_date, r.race, r.bib) as team
      from results r
      join windows w on w.gender = r.gender and not w.closed
    ) a
    where a.team is not null
      and private.uci_ranking_team_eligible(a.team, a.stage_date)
    union all
    select x.gender, x.team, x."globalRiderId", x."penaltyDate", -x.points, x.points
    from (
      select
        p.gender, p."globalRiderId", p."penaltyDate", p.points,
        private.uci_ranking_rider_team(p."globalRiderId", p.gender, p."penaltyDate", p."raceId", p.bib) as team
      from public.uci_ranking_penalties p
      join windows w
        on w.gender = p.gender
       and not w.closed
       and p."penaltyDate" between w.from_date and w.to_date
    ) x
    where x.team is not null
      and private.uci_ranking_team_eligible(x.team, x."penaltyDate")
  ),
  -- Fecha de la base oficial de cada equipo: su última fila oficial; sin
  -- ninguna, la última publicación del género (lo anterior no lo cuenta la UCI).
  cutoffs as (
    select o.gender, o."teamId" as team, max(o."rankingDate") as cutoff
    from official o
    where o."teamId" is not null
    group by o.gender, o."teamId"
  ),
  riders as (
    select
      c.gender, c.team, c.rider_key,
      sum(c.pts) as total,
      coalesce(sum(c.pts) filter (where c.stage_date < coalesce(k.cutoff, w.official_date)), 0) as before_cutoff,
      coalesce(sum(c.penalty) filter (
        where coalesce(k.cutoff, w.official_date) is null or c.stage_date >= coalesce(k.cutoff, w.official_date)
      ), 0) as penalty_after,
      max(c.stage_date) filter (
        where coalesce(k.cutoff, w.official_date) is null or c.stage_date >= coalesce(k.cutoff, w.official_date)
      ) as last_after
    from contributions c
    join windows w on w.gender = c.gender
    left join cutoffs k on k.gender = c.gender and k.team = c.team
    group by c.gender, c.team, c.rider_key
  ),
  riders_ranked as (
    select
      r.*,
      row_number() over (partition by r.gender, r.team order by r.total desc, r.rider_key) as n_now,
      row_number() over (partition by r.gender, r.team order by r.before_cutoff desc, r.rider_key) as n_before
    from riders r
  ),
  team_delta as (
    select
      r.gender, r.team,
      coalesce(sum(r.total) filter (where r.n_now <= w.top_n), 0)
        - coalesce(sum(r.before_cutoff) filter (where r.n_before <= w.top_n), 0) as delta,
      sum(r.penalty_after) as penalty,
      max(r.last_after) as last_date
    from riders_ranked r
    join windows w on w.gender = r.gender
    group by r.gender, r.team
  ),
  merged as (
    select
      o.gender, o."teamId" as team, o."uciTeamId", o.rank as official_rank,
      o."previousRank" as official_previous, o.points as official_points,
      o."teamCategory", o."sourceName", o."displayName", o."teamCode",
      o."countryCode", o."rankingId", o."momentId", o."disciplineSeasonId",
      o."sourceUrl"
    from official o
    union all
    select
      d.gender, d.team, null::bigint, null::smallint, null::smallint, null::numeric,
      null, null, null, null, null, null::integer, null::integer, null::integer, null
    from team_delta d
    join windows w on w.gender = d.gender and not w.closed
    where not exists (
      select 1 from official o where o.gender = d.gender and o."teamId" = d.team
    )
  ),
  decorated as (
    select
      m.*,
      case when w.closed then 0 else coalesce(d.delta, 0) + coalesce(d.penalty, 0) end as provisional,
      case when w.closed then 0 else coalesce(d.penalty, 0) end as penalty,
      coalesce(m.official_points, 0)
        + case when w.closed then 0 else coalesce(d.delta, 0) end as total,
      case when w.closed then null else d.last_date end as last_date,
      ts.name as season_name,
      ts.category as season_category,
      ts."uciCode" as season_code,
      tm.name as team_name,
      upper(nullif(tm."countryCode", '')) as team_country
    from merged m
    join windows w on w.gender = m.gender
    left join team_delta d on d.gender = m.gender and d.team = m.team
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
    where m.team is null
      or exists (
        select 1
        from public.team_seasons lic, ref
        where lic."teamId" = m.team
          and lic.year between ref.ref_year and p_season
          and lic.category in ('WT', 'PT', 'CT', 'WWT', 'PRW', 'CTW')
      )
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
    greatest(coalesce(w.official_date, w.from_date), r.gender_last_date),
    coalesce(r."rankingId", w."rankingId"),
    coalesce(w.moment_id, r."momentId", 0),
    coalesce(r."disciplineSeasonId", w."dataRideSeasonId", 0),
    coalesce(
      w.source_url,
      r."sourceUrl",
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

revoke all on function private.uci_ranking_rider_team(text, text, date, text, text) from public, anon, authenticated;
revoke all on function private.uci_team_ranking_compute(smallint) from public, anon, authenticated;

select private.refresh_uci_team_rankings();
