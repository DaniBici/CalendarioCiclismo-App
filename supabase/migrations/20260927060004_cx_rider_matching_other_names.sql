-- Emparejamiento de fichas CX por nombre plegado o por alias de otherNames.
--
-- Las fichas CX siguen la convención de carretera: firstName con tildes, lastName con
-- el primer apellido y otherNames con el nombre completo de la fuente (alias separados
-- por comas). DataRide, las federaciones y los inscritos publican los dos apellidos,
-- de modo que la comparación exacta firstName/lastName dejaba de enlazar la ficha y la
-- ingesta creaba un duplicado. Un alias coincide cuando contiene exactamente los mismos
-- tokens plegados que el nombre completo de la fila, en cualquier orden.

CREATE OR REPLACE FUNCTION public.cx_rider_name_matches(
  p_first text, p_last text, p_other_names text, q_first text, q_last text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE PARALLEL SAFE
SET search_path TO ''
AS $function$
  SELECT (public.fold_name(p_first)<>'' AND public.fold_name(p_last)<>''
      AND public.fold_name(p_first)=public.fold_name(q_first)
      AND public.fold_name(p_last)=public.fold_name(q_last))
    OR EXISTS(
      SELECT 1 FROM unnest(string_to_array(coalesce(p_other_names,''),',')) AS a(alias)
      WHERE public.fold_name(a.alias)<>''
        AND (SELECT string_agg(t,' ' ORDER BY t) FROM unnest(string_to_array(public.fold_name(a.alias),' ')) AS t)
          =(SELECT string_agg(t,' ' ORDER BY t) FROM unnest(string_to_array(public.fold_name(concat_ws(' ',q_first,q_last)),' ')) AS t))
$function$;

REVOKE ALL ON FUNCTION public.cx_rider_name_matches(text,text,text,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.cx_rider_name_matches(text,text,text,text,text) TO authenticated,cc_results_worker;

-- Sustituye la condición de nombre en las RPC vigentes sin alterar el resto del cuerpo.
DO $patch$
DECLARE
  v_def text; v_old text; v_new text; v_count integer;
BEGIN
  v_def:=pg_get_functiondef('public.cx_ingest_results(text,text,jsonb,text,jsonb)'::regprocedure);
  v_old:='public.fold_name("firstName")=f_first AND public.fold_name("lastName")=f_last';
  v_new:='public.cx_rider_name_matches("firstName","lastName","otherNames",rowv->>''firstName'',rowv->>''lastName'')';
  v_count:=(length(v_def)-length(replace(v_def,v_old,'')))/length(v_old);
  IF v_count<>6 THEN
    RAISE EXCEPTION 'cx_ingest_results: se esperaban 6 condiciones de nombre y hay %',v_count;
  END IF;
  EXECUTE replace(v_def,v_old,v_new);

  v_def:=pg_get_functiondef('public.cx_prepare_startlist_import(text,text,jsonb)'::regprocedure);
  v_old:='lower(btrim("firstName"))=lower(btrim(row."firstName")) AND lower(btrim("lastName"))=lower(btrim(row."lastName"))';
  v_new:='public.cx_rider_name_matches("firstName","lastName","otherNames",row."firstName",row."lastName")';
  v_count:=(length(v_def)-length(replace(v_def,v_old,'')))/length(v_old);
  IF v_count<>4 THEN
    RAISE EXCEPTION 'cx_prepare_startlist_import: se esperaban 4 condiciones de nombre y hay %',v_count;
  END IF;
  EXECUTE replace(v_def,v_old,v_new);
END
$patch$;
