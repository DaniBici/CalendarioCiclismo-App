-- La excepción de mantenimiento solo vale para conexión SQL administrativa sin
-- JWT ni cambio de rol. Permite verificar con el rol real del panel sin elevarlo.
CREATE OR REPLACE FUNCTION private.assert_startlist_import_admin()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NOT COALESCE(private.is_admin(), false)
     AND COALESCE(auth.role(), '') <> 'service_role'
     AND NOT (session_user IN ('postgres','supabase_admin')
       AND auth.role() IS NULL AND current_setting('role') = 'none') THEN
    RAISE EXCEPTION 'Se requieren permisos de administración' USING ERRCODE = '42501';
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION private.assert_startlist_import_admin() FROM PUBLIC, anon, authenticated;
