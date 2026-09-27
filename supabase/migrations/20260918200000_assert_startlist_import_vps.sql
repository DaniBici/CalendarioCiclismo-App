-- Permite al rol del VPS (cc_results_worker) aplicar startlists a través de la
-- única RPC expuesta (`vps_import_tissot_startlist`).
--
-- La cadena prepare/apply es SECURITY DEFINER, pero su aserción de administración
-- (`private.assert_startlist_import_admin`) bloqueaba a un rol de conexión sin JWT:
-- `private.is_admin()` es falso (auth.uid() null) y `auth.role()` no es
-- 'service_role'. Comprobado contra el worker real: `session_user=cc_results_worker`,
-- `current_setting('role')='none'`, sin acceso al esquema `auth`.
--
-- Se añade `cc_results_worker` a la lista blanca de la aserción (junto a
-- postgres/supabase_admin) y se le RETIRA el EXECUTE directo de prepare/apply para
-- que solo pueda entrar por la envoltura, que fija el documento y `provisional=false`.

REVOKE EXECUTE ON FUNCTION public.prepare_startlist_import(text, jsonb, boolean) FROM cc_results_worker;
REVOKE EXECUTE ON FUNCTION public.apply_startlist_import(uuid, jsonb) FROM cc_results_worker;

CREATE OR REPLACE FUNCTION private.assert_startlist_import_admin()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
BEGIN
  IF NOT COALESCE(private.is_admin(), false)
     AND COALESCE(auth.role(), '') <> 'service_role'
     AND NOT (session_user IN ('postgres','supabase_admin','cc_results_worker')
       AND auth.role() IS NULL AND current_setting('role') = 'none') THEN
    RAISE EXCEPTION 'Se requieren permisos de administración' USING ERRCODE = '42501';
  END IF;
END;
$function$;
