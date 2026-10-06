-- Comprobación de administración para las Edge Functions que actúan con el JWT
-- del usuario (r2-upload). Devuelve únicamente el estado de quien llama y no
-- expone private.admin_users. SECURITY INVOKER: private.is_admin() ya es
-- SECURITY DEFINER y authenticated tiene EXECUTE sobre ella. Es STABLE para
-- poder llamarla por GET, que el pre-request no bloquea a los no administradores
-- (por POST recibirían 42501 en lugar de false).

create function public.is_admin()
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce((select private.is_admin()), false);
$$;

revoke all on function public.is_admin() from public, anon, authenticated, service_role;
grant execute on function public.is_admin() to authenticated;

comment on function public.is_admin() is
  'Indica si el usuario autenticado figura en private.admin_users. Uso: autorización de Edge Functions con el JWT del usuario.';

notify pgrst, 'reload schema';
