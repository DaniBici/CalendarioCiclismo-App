-- Hotfix: no confiar en el cortocircuito de OR para evitar que una petición
-- anon evalúe private.is_admin(), función que deliberadamente no puede ejecutar.

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
  if v_role <> 'authenticated' then
    return;
  end if;

  if (select private.is_admin()) then
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

notify pgrst, 'reload schema';
