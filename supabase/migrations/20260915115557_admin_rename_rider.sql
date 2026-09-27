-- RPC de renombrado de slug de corredor: reasigna el id y re-punta las referencias blandas
-- en una transacción. No hay claves ajenas sobre esos ids y las tablas *_resolved son vistas.

CREATE OR REPLACE FUNCTION public.admin_rename_rider(p_gender text, p_old_id text, p_new_id text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_tabla text; v_fila boolean; v_ocupado boolean;
  v_startlist int; v_resultados int; v_afiliaciones int; v_transferencias int; v_alias int; v_orden int;
BEGIN
  IF p_gender NOT IN ('male','female') THEN
    RAISE EXCEPTION 'Género inválido; usar male o female' USING ERRCODE='22023'; END IF;
  IF p_old_id IS NULL OR p_new_id IS NULL THEN
    RAISE EXCEPTION 'Identificadores obligatorios' USING ERRCODE='22023'; END IF;
  IF p_new_id = p_old_id THEN
    RAISE EXCEPTION 'El slug nuevo coincide con el actual' USING ERRCODE='22023'; END IF;
  IF p_new_id !~ '^[a-z0-9-]{1,80}$' THEN
    RAISE EXCEPTION 'Slug nuevo inválido' USING ERRCODE='22023'; END IF;
  v_tabla:=CASE p_gender WHEN 'male' THEN 'riders_men' ELSE 'riders_women' END;
  EXECUTE format('SELECT true FROM public.%I WHERE id=$1 FOR UPDATE', v_tabla) INTO v_fila USING p_old_id;
  IF v_fila IS NULL THEN
    RAISE EXCEPTION 'Corredor % no encontrado', p_old_id USING ERRCODE='22023'; END IF;
  EXECUTE format('SELECT EXISTS(SELECT 1 FROM public.%I WHERE id=$1)', v_tabla) INTO v_ocupado USING p_new_id;
  IF v_ocupado THEN
    RAISE EXCEPTION 'El slug % ya está ocupado', p_new_id USING ERRCODE='22023'; END IF;
  EXECUTE format('UPDATE public.%I SET id=$1 WHERE id=$2', v_tabla) USING p_new_id, p_old_id;
  EXECUTE 'UPDATE public.startlist_riders SET "globalRiderId"=$1 WHERE "globalRiderId"=$2' USING p_new_id, p_old_id;
  GET DIAGNOSTICS v_startlist=ROW_COUNT;
  EXECUTE 'UPDATE public.race_uci_results SET "globalRiderId"=$1 WHERE "globalRiderId"=$2' USING p_new_id, p_old_id;
  GET DIAGNOSTICS v_resultados=ROW_COUNT;
  EXECUTE 'UPDATE public.rider_team_affiliations SET "riderId"=$1 WHERE "riderId"=$2' USING p_new_id, p_old_id;
  GET DIAGNOSTICS v_afiliaciones=ROW_COUNT;
  EXECUTE 'UPDATE public.rider_transfers SET "riderId"=$1 WHERE "riderId"=$2' USING p_new_id, p_old_id;
  GET DIAGNOSTICS v_transferencias=ROW_COUNT;
  EXECUTE 'UPDATE public.rider_identity_aliases SET "riderId"=$1 WHERE "riderId"=$2' USING p_new_id, p_old_id;
  GET DIAGNOSTICS v_alias=ROW_COUNT;
  EXECUTE 'UPDATE public.start_order_entries SET "riderId"=$1 WHERE "riderId"=$2' USING p_new_id, p_old_id;
  GET DIAGNOSTICS v_orden=ROW_COUNT;
  EXECUTE format('UPDATE public.%I SET "updatedAt"=now() WHERE id=$1', v_tabla) USING p_new_id;
  RETURN jsonb_build_object('table',v_tabla,'oldId',p_old_id,'newId',p_new_id,'riders',1,
    'startlist_riders',v_startlist,'race_uci_results',v_resultados,
    'rider_team_affiliations',v_afiliaciones,'rider_transfers',v_transferencias,
    'rider_identity_aliases',v_alias,'start_order_entries',v_orden);
END $$;

COMMENT ON FUNCTION public.admin_rename_rider(text,text,text) IS 'Renombra el slug de un corredor de carretera y re-vincula startlists, resultados, afiliaciones, transferencias, alias y orden de salida en una transacción.';

CREATE OR REPLACE FUNCTION public.cx_rename_rider(p_gender text, p_old_id text, p_new_id text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_tabla text; v_fila boolean; v_ocupado boolean;
  v_startlist int; v_resultados int; v_general int;
BEGIN
  IF p_gender NOT IN ('male','female') THEN
    RAISE EXCEPTION 'Género inválido; usar male o female' USING ERRCODE='22023'; END IF;
  IF p_old_id IS NULL OR p_new_id IS NULL THEN
    RAISE EXCEPTION 'Identificadores obligatorios' USING ERRCODE='22023'; END IF;
  IF p_new_id = p_old_id THEN
    RAISE EXCEPTION 'El slug nuevo coincide con el actual' USING ERRCODE='22023'; END IF;
  IF p_new_id !~ '^[a-z0-9-]{1,80}$' THEN
    RAISE EXCEPTION 'Slug nuevo inválido' USING ERRCODE='22023'; END IF;
  v_tabla:=CASE p_gender WHEN 'male' THEN 'cx_riders_men' ELSE 'cx_riders_women' END;
  EXECUTE format('SELECT true FROM public.%I WHERE id=$1 FOR UPDATE', v_tabla) INTO v_fila USING p_old_id;
  IF v_fila IS NULL THEN
    RAISE EXCEPTION 'Corredor % no encontrado', p_old_id USING ERRCODE='22023'; END IF;
  EXECUTE format('SELECT EXISTS(SELECT 1 FROM public.%I WHERE id=$1)', v_tabla) INTO v_ocupado USING p_new_id;
  IF v_ocupado THEN
    RAISE EXCEPTION 'El slug % ya está ocupado', p_new_id USING ERRCODE='22023'; END IF;
  EXECUTE format('UPDATE public.%I SET id=$1 WHERE id=$2', v_tabla) USING p_new_id, p_old_id;
  EXECUTE 'UPDATE public.cx_startlist_riders SET "globalRiderId"=$1 WHERE "globalRiderId"=$2' USING p_new_id, p_old_id;
  GET DIAGNOSTICS v_startlist=ROW_COUNT;
  EXECUTE 'UPDATE public.cx_results SET "globalRiderId"=$1 WHERE "globalRiderId"=$2' USING p_new_id, p_old_id;
  GET DIAGNOSTICS v_resultados=ROW_COUNT;
  EXECUTE 'UPDATE public.cx_tournament_standings SET "globalRiderId"=$1 WHERE "globalRiderId"=$2' USING p_new_id, p_old_id;
  GET DIAGNOSTICS v_general=ROW_COUNT;
  EXECUTE format('UPDATE public.%I SET "updatedAt"=now() WHERE id=$1', v_tabla) USING p_new_id;
  RETURN jsonb_build_object('table',v_tabla,'oldId',p_old_id,'newId',p_new_id,'riders',1,
    'cx_startlist_riders',v_startlist,'cx_results',v_resultados,'cx_tournament_standings',v_general);
END $$;

COMMENT ON FUNCTION public.cx_rename_rider(text,text,text) IS 'Renombra el slug de una ficha CX y re-vincula startlists, resultados y generales de torneo en una transacción.';

REVOKE ALL ON FUNCTION public.admin_rename_rider(text,text,text),public.cx_rename_rider(text,text,text)
  FROM PUBLIC,anon,authenticated,service_role,cc_results_worker;
GRANT EXECUTE ON FUNCTION public.admin_rename_rider(text,text,text),public.cx_rename_rider(text,text,text)
  TO authenticated,cc_results_worker;

NOTIFY pgrst,'reload schema';
