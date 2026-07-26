-- Ajustes residuales tras reejecutar Advisors:
-- 1) las apps publicadas llaman las RPC push con el rol anon;
-- 2) los esquemas no expuestos reciben una política de denegación explícita
--    para que RLS documente también la intención.

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
    execute format(
      'revoke execute on function %s from authenticated',
      f.signature
    );
  end loop;
end
$$;

drop policy if exists "admin_users_deny_api" on private.admin_users;
create policy "admin_users_deny_api"
  on private.admin_users for all to public
  using (false)
  with check (false);

do $$
declare
  t record;
begin
  for t in
    select c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'archive'
      and c.relkind in ('r', 'p')
  loop
    execute format(
      'drop policy if exists %I on archive.%I',
      'archive_deny_api', t.relname
    );
    execute format(
      'create policy %I on archive.%I for all to public using (false) with check (false)',
      'archive_deny_api', t.relname
    );
  end loop;
end
$$;
