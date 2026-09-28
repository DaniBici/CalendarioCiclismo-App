-- cx_rename_rider re-vinculaba cx_startlist_riders, cx_results y cx_tournament_standings
-- solo por globalRiderId. cx_riders_men y cx_riders_women tienen espacios de id
-- independientes (la ingesta solo comprueba la tabla de su género al generar un id), de
-- modo que un id presente en ambas re-vinculaba también las filas de la otra ficha. Las
-- tres tablas guardan la categoría (ME/MU/MJ, WE/WU/WJ): se filtra por su inicial, como
-- hacen los triggers de generales. El resultado informa de si el id está compartido.

CREATE OR REPLACE FUNCTION public.cx_rename_rider(
  p_gender text,
  p_old_id text,
  p_new_id text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_tabla text;
  v_otra text;
  v_prefijo text;
  v_fila boolean;
  v_ocupado boolean;
  v_compartido boolean;
  v_startlist integer;
  v_resultados integer;
  v_general integer;
BEGIN
  IF NOT COALESCE(private.is_admin(), false) THEN
    RAISE EXCEPTION 'Se requieren permisos de administración' USING ERRCODE = '42501';
  END IF;
  IF p_gender NOT IN ('male', 'female') THEN
    RAISE EXCEPTION 'Género inválido; usar male o female' USING ERRCODE = '22023';
  END IF;
  IF p_old_id IS NULL OR p_new_id IS NULL THEN
    RAISE EXCEPTION 'Identificadores obligatorios' USING ERRCODE = '22023';
  END IF;
  IF p_new_id = p_old_id THEN
    RAISE EXCEPTION 'El slug nuevo coincide con el actual' USING ERRCODE = '22023';
  END IF;
  IF p_new_id !~ '^[a-z0-9-]{1,80}$' THEN
    RAISE EXCEPTION 'Slug nuevo inválido' USING ERRCODE = '22023';
  END IF;

  v_tabla := CASE p_gender WHEN 'male' THEN 'cx_riders_men' ELSE 'cx_riders_women' END;
  v_otra := CASE p_gender WHEN 'male' THEN 'cx_riders_women' ELSE 'cx_riders_men' END;
  v_prefijo := CASE p_gender WHEN 'male' THEN 'M' ELSE 'W' END;
  EXECUTE pg_catalog.format('SELECT true FROM public.%I WHERE id = $1 FOR UPDATE', v_tabla)
    INTO v_fila USING p_old_id;
  IF v_fila IS NULL THEN
    RAISE EXCEPTION 'Corredor % no encontrado', p_old_id USING ERRCODE = '22023';
  END IF;
  EXECUTE pg_catalog.format('SELECT EXISTS (SELECT 1 FROM public.%I WHERE id = $1)', v_tabla)
    INTO v_ocupado USING p_new_id;
  IF v_ocupado THEN
    RAISE EXCEPTION 'El slug % ya está ocupado', p_new_id USING ERRCODE = '22023';
  END IF;
  EXECUTE pg_catalog.format('SELECT EXISTS (SELECT 1 FROM public.%I WHERE id = $1)', v_otra)
    INTO v_compartido USING p_old_id;

  EXECUTE pg_catalog.format('UPDATE public.%I SET id = $1 WHERE id = $2', v_tabla)
    USING p_new_id, p_old_id;
  UPDATE public.cx_startlist_riders SET "globalRiderId" = p_new_id
  WHERE "globalRiderId" = p_old_id AND pg_catalog.left(category, 1) = v_prefijo;
  GET DIAGNOSTICS v_startlist = ROW_COUNT;
  UPDATE public.cx_results SET "globalRiderId" = p_new_id
  WHERE "globalRiderId" = p_old_id AND pg_catalog.left(category, 1) = v_prefijo;
  GET DIAGNOSTICS v_resultados = ROW_COUNT;
  UPDATE public.cx_tournament_standings SET "globalRiderId" = p_new_id
  WHERE "globalRiderId" = p_old_id AND pg_catalog.left(category, 1) = v_prefijo;
  GET DIAGNOSTICS v_general = ROW_COUNT;
  EXECUTE pg_catalog.format('UPDATE public.%I SET "updatedAt" = pg_catalog.now() WHERE id = $1', v_tabla)
    USING p_new_id;

  RETURN pg_catalog.jsonb_build_object(
    'table', v_tabla, 'oldId', p_old_id, 'newId', p_new_id, 'riders', 1,
    'sharedAcrossGenders', v_compartido,
    'cx_startlist_riders', v_startlist, 'cx_results', v_resultados,
    'cx_tournament_standings', v_general
  );
END;
$function$;

COMMENT ON FUNCTION public.cx_rename_rider(text,text,text) IS
  'Renombra el slug de una ficha CX y re-vincula por género (inicial de la categoría) startlists, resultados y generales de torneo en una transacción.';

REVOKE ALL ON FUNCTION public.cx_rename_rider(text, text, text)
  FROM PUBLIC, anon, authenticated, service_role, cc_results_worker;
GRANT EXECUTE ON FUNCTION public.cx_rename_rider(text, text, text) TO authenticated;
