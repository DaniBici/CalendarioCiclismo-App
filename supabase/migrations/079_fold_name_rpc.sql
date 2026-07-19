-- ═══════════════════════════════════════════════════════════════════
--  RPC fold_name_rpc — expone fold_name(text) a clientes autenticados
--
--  El panel genera el id (slug apellido-nombre) de un corredor nuevo. Para que
--  ese slug use EXACTAMENTE el mismo plegado canónico que el catálogo y el RPC
--  resolve_riders (fold_name SQL: mapa explícito de diacríticos ø/ł/ß/æ/œ +
--  ligaduras, NO el NFD+strip de JS que los corrompe), se expone fold_name como
--  RPC. Así el slug del panel deja de divergir del resto del sistema.
--
--  fold_name es IMMUTABLE y de solo lectura → SECURITY INVOKER basta; se restringe
--  a authenticated por higiene (no es dato sensible, pero no hace falta exponerlo a anon).
-- ═══════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.fold_name_rpc(p_text text)
RETURNS text
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT public.fold_name(p_text)
$$;

REVOKE ALL ON FUNCTION public.fold_name_rpc(text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.fold_name_rpc(text) TO authenticated, service_role;
