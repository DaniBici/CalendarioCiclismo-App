-- Registro privado de administradores para no equiparar "authenticated" con
-- "administrador". El alta inicial se hace por MCP entre esta migración y la
-- siguiente; así ningún UUID generado queda codificado en el repositorio.

create schema if not exists private;

revoke all on schema private from public, anon, authenticated;

create table if not exists private.admin_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  note text
);

alter table private.admin_users enable row level security;

revoke all on table private.admin_users from public, anon, authenticated;
grant all on table private.admin_users to service_role;

create or replace function private.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from private.admin_users
    where user_id = (select auth.uid())
  );
$$;

revoke all on function private.is_admin() from public, anon, authenticated, service_role;

-- La función no está en un esquema expuesto por PostgREST. Los roles de API
-- solo pueden usarla como predicado de RLS; no obtienen acceso a la tabla.
grant usage on schema private to authenticated, service_role;
grant execute on function private.is_admin() to authenticated, service_role;

comment on table private.admin_users is
  'Lista explícita de usuarios autorizados para operar el panel y las RPC administrativas.';

comment on function private.is_admin() is
  'Predicado central de autorización administrativa basado en auth.uid().';
