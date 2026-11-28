-- ═══════════════════════════════════════════════════════════════════
--  RÁNKING UCI DE EQUIPOS: PASO AUTOMÁTICO DE TEMPORADA
--
--  Cuando termina la temporada publicada y la siguiente ya ha empezado,
--  public.uci_team_rankings pasa a la temporada nueva sin esperar a enero.
--  Al aplicarse, el primer recálculo publica el ránking 2027 (19-10-2026 a
--  17-10-2027).
--
--  Aplicar solo con el VPS ya actualizado: el sincronizador anterior
--  sustituye la tabla pública por el ránking final de 2026.
-- ═══════════════════════════════════════════════════════════════════

create or replace function private.refresh_uci_team_rankings()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_season smallint;
  v_next smallint;
  v_fresh jsonb;
  v_current jsonb;
  v_changed boolean;
begin
  perform pg_advisory_xact_lock(hashtext('uci_team_rankings_sync'));

  -- Paso automático: terminada la temporada publicada, se publica la
  -- siguiente en cuanto empieza (decisión de Dani del 2026-11-24, que revoca
  -- la del 2026-11-02 de conservar el ránking final hasta enero).
  select n."seasonYear" into v_next
  from public.uci_ranking_seasons p
  join public.uci_ranking_seasons n
    on n."seasonYear" > p."seasonYear"
   and n."startDate" <= (now() at time zone 'Europe/Madrid')::date
  where p."isPublished"
    and p."endDate" < (now() at time zone 'Europe/Madrid')::date
  order by n."seasonYear" desc
  limit 1;
  if v_next is not null then
    update public.uci_ranking_seasons
    set "isPublished" = false, "updatedAt" = now()
    where "isPublished";
    update public.uci_ranking_seasons
    set "isPublished" = true, "updatedAt" = now()
    where "seasonYear" = v_next;
  end if;

  select s."seasonYear" into v_season
  from public.uci_ranking_seasons s
  where s."isPublished";
  if v_season is null then
    return jsonb_build_object('season', null, 'changed', false);
  end if;

  select coalesce(jsonb_agg(to_jsonb(c) order by c.gender, c.rank), '[]'::jsonb)
  into v_fresh
  from private.uci_team_ranking_compute(v_season) c;

  -- Sin filas calculadas (temporada recién empezada, sin instantánea ni
  -- resultados), se conserva la tabla: nunca se publica un ránking vacío.
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

revoke all on function private.refresh_uci_team_rankings() from public, anon, authenticated;

select private.refresh_uci_team_rankings();
