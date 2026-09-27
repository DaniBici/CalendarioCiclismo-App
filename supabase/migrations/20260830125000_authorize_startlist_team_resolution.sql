-- La RPC conserva acceso para authenticated porque la consume el panel, pero
-- comprueba la lista privada de administradores dentro de SECURITY DEFINER.

DO $$
DECLARE
  v_definition text;
BEGIN
  SELECT pg_get_functiondef('public.ensure_startlist_team(text,text,text)'::regprocedure)
  INTO v_definition;

  v_definition := replace(
    v_definition,
    E'BEGIN\n  IF v_name IS NULL THEN',
    E'BEGIN\n  IF NOT ((select private.is_admin()) OR (select auth.role()) = ''service_role'') THEN\n    RAISE EXCEPTION ''La operación requiere permisos de administración'' USING ERRCODE = ''42501'';\n  END IF;\n\n  IF v_name IS NULL THEN'
  );

  IF v_definition = pg_get_functiondef('public.ensure_startlist_team(text,text,text)'::regprocedure) THEN
    RAISE EXCEPTION 'No se pudo insertar el guard de administración en ensure_startlist_team';
  END IF;

  EXECUTE v_definition;
END;
$$;
