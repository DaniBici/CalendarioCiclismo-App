-- Expone al panel administrativo las plantillas históricas ya importadas sin
-- convertir observaciones anuales UCI en afiliaciones contractuales fechadas.
begin;

create or replace function public.admin_get_team_roster(
  p_team_id text,
  p_year integer
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rows jsonb;
begin
  perform private.assert_startlist_import_admin();
  if p_year not between 1900 and 2100 then
    raise exception 'Temporada no válida' using errcode = '22023';
  end if;
  if not exists (select 1 from public.teams where id = p_team_id) then
    raise exception 'Equipo no encontrado' using errcode = 'P0002';
  end if;

  with roster_rows as (
    select
      a.id,
      a."riderId",
      a."riderGender",
      a."dateFrom",
      a."dateTo",
      a."affiliationType",
      a."sourceUrl",
      a."dateBasis",
      false as "readOnly",
      'affiliation'::text as "sourceKind",
      0 as sort_order
    from public.rider_team_affiliations a
    where a."teamId" = p_team_id and a.year = p_year

    union all

    select
      concat_ws(':', 'uci-roster', o.year, o."uciTeamProfileId", o."uciRiderProfileId", o."observationType") as id,
      o."riderId",
      o.gender as "riderGender",
      null::date as "dateFrom",
      null::date as "dateTo",
      o."observationType" as "affiliationType",
      o."sourceUrl",
      null::text as "dateBasis",
      true as "readOnly",
      'uci_observation'::text as "sourceKind",
      1 as sort_order
    from private.historical_team_roster_observations o
    where o."teamId" = p_team_id
      and o.year = p_year
      and not exists (
        select 1
        from public.rider_team_affiliations a
        where a."teamId" = o."teamId"
          and a.year = o.year
          and a."riderId" = o."riderId"
          and a."riderGender" = o.gender
          and a."affiliationType" = o."observationType"
      )
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', id,
        'riderId', "riderId",
        'riderGender', "riderGender",
        'dateFrom', "dateFrom",
        'dateTo', "dateTo",
        'affiliationType', "affiliationType",
        'sourceUrl', "sourceUrl",
        'dateBasis', "dateBasis",
        'readOnly', "readOnly",
        'sourceKind', "sourceKind"
      ) order by sort_order, "affiliationType", "riderGender", "riderId"
    ),
    '[]'::jsonb
  ) into v_rows
  from roster_rows;

  return v_rows;
end;
$$;

revoke all on function public.admin_get_team_roster(text, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.admin_get_team_roster(text, integer)
  to authenticated, service_role;

comment on function public.admin_get_team_roster(text, integer) is
  'Devuelve la plantilla administrativa de una temporada combinando afiliaciones editables y observaciones UCI históricas de solo lectura.';

commit;
