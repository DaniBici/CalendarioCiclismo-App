-- Endurecimiento derivado de los Advisors de seguridad y rendimiento:
-- privilegios por defecto, RLS administrativo, RPC SECURITY DEFINER,
-- Storage, tablas de respaldo e índices de claves foráneas.

do $$
begin
  if not exists (select 1 from private.admin_users) then
    raise exception
      'private.admin_users está vacío: registrar al menos un administrador antes de aplicar';
  end if;
end
$$;

-- ── 1. Privilegios por defecto: cada objeto futuro debe declarar sus GRANT ──

alter default privileges for role postgres in schema public
  revoke select, insert, update, delete on tables
  from anon, authenticated, service_role;

alter default privileges for role postgres in schema public
  revoke usage, select on sequences
  from anon, authenticated, service_role;

alter default privileges for role postgres in schema public
  revoke execute on functions
  from public, anon, authenticated, service_role;

-- ── 2. Backups fuera del esquema expuesto por la Data API ─────────────────

create schema if not exists archive;
revoke all on schema archive from public, anon, authenticated, service_role;

do $$
declare
  v_table text;
begin
  foreach v_table in array array[
    'market_baseline_bak_20260720_affiliations',
    'market_baseline_bak_20260720_transfers',
    'market_dup_transfers_bak_20260720',
    'saneo_0720_rider_merges'
  ]
  loop
    if to_regclass(format('public.%I', v_table)) is not null then
      execute format('alter table public.%I set schema archive', v_table);
    end if;
  end loop;
end
$$;

revoke all on all tables in schema archive
  from public, anon, authenticated, service_role;

-- ── 3. RLS: authenticated deja de equivaler a administrador ───────────────

drop policy if exists "public_insert_reports" on public.reports;
revoke insert on table public.reports from anon, authenticated;
revoke usage, select on sequence public.reports_id_seq from anon, authenticated;

alter policy "auth_select_reports" on public.reports
  using ((select private.is_admin()));

drop policy if exists "anon_read" on public.scheduled_push_notifications;
revoke all on table public.scheduled_push_notifications from anon;

drop policy if exists "route_gpx_public_read" on storage.objects;

-- Todas las políticas de escritura del panel pasan por el mismo registro
-- administrativo. Se preservan los comandos y nombres actuales.
do $$
declare
  p record;
begin
  for p in
    select schemaname, tablename, policyname, cmd
    from pg_policies
    where schemaname in ('public', 'storage')
      and 'authenticated' = any(roles)
      and cmd in ('ALL', 'INSERT', 'UPDATE', 'DELETE')
      and not (
        schemaname = 'public'
        and tablename = 'pg_cron_config'
        and policyname = 'admin_only'
      )
  loop
    if p.cmd = 'INSERT' then
      execute format(
        'alter policy %I on %I.%I with check ((select private.is_admin()))',
        p.policyname, p.schemaname, p.tablename
      );
    elsif p.cmd = 'DELETE' then
      execute format(
        'alter policy %I on %I.%I using ((select private.is_admin()))',
        p.policyname, p.schemaname, p.tablename
      );
    else
      execute format(
        'alter policy %I on %I.%I using ((select private.is_admin())) with check ((select private.is_admin()))',
        p.policyname, p.schemaname, p.tablename
      );
    end if;
  end loop;
end
$$;

alter policy "auth_read_push_subscriptions" on public.push_subscriptions
  using ((select private.is_admin()));

do $$
begin
  if exists (
    select 1
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'uci_reports_auth_read'
  ) then
    alter policy "uci_reports_auth_read" on storage.objects
      using (bucket_id = 'uci-reports' and (select private.is_admin()));
  end if;
end
$$;

-- Tablas internas que tenían RLS activado pero ninguna política.
revoke all on table public.beta_android_signups from anon, authenticated;
grant select on table public.beta_android_signups to authenticated;
drop policy if exists "beta_android_signups_admin_read" on public.beta_android_signups;
create policy "beta_android_signups_admin_read"
  on public.beta_android_signups for select to authenticated
  using ((select private.is_admin()));

revoke all on table public.rider_identity_aliases from anon, authenticated;
grant select, insert, update, delete
  on table public.rider_identity_aliases to authenticated;
drop policy if exists "rider_identity_aliases_admin_all"
  on public.rider_identity_aliases;
create policy "rider_identity_aliases_admin_all"
  on public.rider_identity_aliases for all to authenticated
  using ((select private.is_admin()))
  with check ((select private.is_admin()));

revoke all on table public.web_pages_regen_state from anon, authenticated;
grant select, update on table public.web_pages_regen_state to authenticated;
drop policy if exists "web_pages_regen_state_admin_all"
  on public.web_pages_regen_state;
create policy "web_pages_regen_state_admin_all"
  on public.web_pages_regen_state for all to authenticated
  using ((select private.is_admin()))
  with check ((select private.is_admin()));

-- ── 4. RPC: mínimo privilegio y SECURITY INVOKER cuando es posible ─────────

-- Funciones internas/trigger: solo backend. Los triggers no necesitan que el
-- rol que modifica la tabla tenga EXECUTE directo sobre su función.
do $$
declare
  f record;
begin
  for f in
    select p.oid::regprocedure as signature
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = any(array[
        '_dispatch_web_pages_workflows',
        'get_race_filter_keys',
        'ingest_startlist',
        'race_day_inherit_slug_from_oneday_race',
        'sync_rider_to_affiliation',
        'trigger_uci_results_today_workflow',
        'web_pages_regen_tick'
      ])
  loop
    execute format(
      'revoke all on function %s from public, anon, authenticated, service_role',
      f.signature
    );
    execute format('grant execute on function %s to service_role', f.signature);
  end loop;
end
$$;

-- Estas RPC solo usan tablas públicas. SECURITY INVOKER hace que cumplan RLS
-- y elimina el bypass implícito del owner.
do $$
declare
  f record;
begin
  for f in
    select p.oid::regprocedure as signature
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = any(array[
        'admin_mark_web_pages_dirty',
        'resolve_riders',
        'resolve_uci_results',
        'resolve_uci_results_by_name',
        'resolve_uci_startlist',
        'sync_startlist_riders_to_canonical'
      ])
  loop
    execute format('alter function %s security invoker', f.signature);
    execute format(
      'revoke all on function %s from public, anon, authenticated, service_role',
      f.signature
    );
    execute format(
      'grant execute on function %s to authenticated, service_role',
      f.signature
    );
  end loop;
end
$$;

-- Las RPC que acceden a Vault deben conservar SECURITY DEFINER. Quedan
-- ejecutables por el panel, pero el pre-request inferior exige ser admin.
do $$
declare
  f record;
begin
  for f in
    select p.oid::regprocedure as signature
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = any(array[
        'admin_trigger_uci_results_workflow',
        'admin_trigger_web_pages_workflow'
      ])
  loop
    execute format(
      'revoke all on function %s from public, anon, authenticated, service_role',
      f.signature
    );
    execute format(
      'grant execute on function %s to authenticated, service_role',
      f.signature
    );
  end loop;
end
$$;

-- Compatibilidad con versiones publicadas de web/iOS/Android. Se elimina el
-- grant implícito a PUBLIC, pero se mantienen anon/authenticated explícitos.
do $$
declare
  f record;
begin
  for f in
    select p.oid::regprocedure as signature
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = any(array[
        'set_push_subscription_full',
        'set_push_subscription_v2',
        'set_push_subscription_v3',
        'set_push_subscription_with_categories'
      ])
  loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role', f.signature);
    execute format('grant execute on function %s to anon, authenticated, service_role', f.signature);
  end loop;
end
$$;

-- Defensa global de la Data API: aunque una política futura vuelva a usar
-- "auth.uid() is not null", un usuario autenticado no administrativo no puede
-- mutar tablas ni llamar RPC POST. Las RPC push son la única excepción.
create or replace function public.cc_check_request()
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_claims jsonb := coalesce(
    nullif(current_setting('request.jwt.claims', true), ''),
    '{}'
  )::jsonb;
  v_role text := coalesce(v_claims ->> 'role', '');
  v_method text := upper(coalesce(current_setting('request.method', true), ''));
  v_path text := ltrim(
    split_part(coalesce(current_setting('request.path', true), ''), '?', 1),
    '/'
  );
begin
  if v_role <> 'authenticated' or (select private.is_admin()) then
    return;
  end if;

  if v_method not in ('POST', 'PUT', 'PATCH', 'DELETE') then
    return;
  end if;

  if v_path = any(array[
    'rpc/set_push_subscription_full',
    'rpc/set_push_subscription_v2',
    'rpc/set_push_subscription_v3',
    'rpc/set_push_subscription_with_categories'
  ]) then
    return;
  end if;

  raise exception using
    errcode = '42501',
    message = 'La operación requiere permisos de administración';
end;
$$;

revoke all on function public.cc_check_request()
  from public, anon, authenticated, service_role, authenticator;
grant execute on function public.cc_check_request()
  to anon, authenticated, service_role, authenticator;

alter role authenticator
  set pgrst.db_pre_request = 'public.cc_check_request';

notify pgrst, 'reload config';
notify pgrst, 'reload schema';

-- ── 5. Índices de las claves foráneas señaladas por el Advisor ─────────────

create index if not exists idx_scheduled_push_notifications_race_day_id
  on public.scheduled_push_notifications ("raceDayId");

create index if not exists idx_scheduled_push_notifications_race_id
  on public.scheduled_push_notifications ("raceId");

create index if not exists idx_start_order_entries_rider_id
  on public.start_order_entries ("riderId");

create index if not exists idx_today_highlights_race_day_id
  on public.today_highlights ("raceDayId");

create index if not exists idx_today_highlights_race_id
  on public.today_highlights ("raceId");
