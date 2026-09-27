-- El panel edita identidad; los reglamentos y traducciones se gestionan por LLM.
-- Omitir esas claves conserva el valor vigente bajo el lock de la fila.
CREATE OR REPLACE FUNCTION public.cx_save_tournament(p_tournament jsonb) RETURNS text
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE t public.cx_tournaments; item record; scheme jsonb; previous jsonb; saved jsonb;
BEGIN
  PERFORM public.cx_require_admin();
  t:=jsonb_populate_record(NULL::public.cx_tournaments,p_tournament);
  t.id:=coalesce(t.id,gen_random_uuid()::text);
  SELECT to_jsonb(x) INTO previous FROM public.cx_tournaments x WHERE id=t.id FOR UPDATE;
  IF NOT p_tournament ? 'pointsScheme' THEN
    t."pointsScheme":=coalesce(previous->'pointsScheme','{"version":1,"status":"draft","categories":{}}'::jsonb);
  END IF;
  IF NOT p_tournament ? 'translations' THEN
    t.translations:=coalesce(previous->'translations','{}'::jsonb);
  END IF;
  scheme:=t."pointsScheme";
  IF jsonb_typeof(scheme) IS DISTINCT FROM 'object' OR jsonb_typeof(scheme->'categories') IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'El reglamento debe definir categorías' USING ERRCODE='22023';
  END IF;
  FOR item IN SELECT * FROM jsonb_each(scheme->'categories') LOOP
    IF item.key NOT IN ('ME','WE','MU','WU','MJ','WJ') OR coalesce(item.value->>'mode','') NOT IN ('points','time') THEN
      RAISE EXCEPTION 'Modalidad/categoría inválida: %',item.key USING ERRCODE='22023';
    END IF;
    IF item.value->>'mode'='points' THEN
      IF jsonb_typeof(item.value->'perRank') IS DISTINCT FROM 'array' OR jsonb_array_length(item.value->'perRank')=0
        OR EXISTS(SELECT 1 FROM jsonb_array_elements(item.value->'perRank') p WHERE jsonb_typeof(p)<>'number') THEN
        RAISE EXCEPTION 'Faltan puntos por puesto: %',item.key USING ERRCODE='22023';
      END IF;
    ELSIF item.value ? 'perRank' THEN
      RAISE EXCEPTION 'La general por tiempo no admite puntos por puesto' USING ERRCODE='22023';
    END IF;
  END LOOP;
  INSERT INTO public.cx_tournaments(id,name,"nameEn",slug,"seasonKey","colorHex","logoUrl",translations,"pointsScheme")
    VALUES(t.id,t.name,t."nameEn",t.slug,t."seasonKey",t."colorHex",t."logoUrl",coalesce(t.translations,'{}'),scheme)
    ON CONFLICT(id) DO UPDATE SET name=excluded.name,"nameEn"=excluded."nameEn",slug=excluded.slug,"seasonKey"=excluded."seasonKey","colorHex"=excluded."colorHex","logoUrl"=excluded."logoUrl",translations=excluded.translations,"pointsScheme"=excluded."pointsScheme","updatedAt"=now();
  IF previous IS NOT NULL AND previous->'pointsScheme' IS DISTINCT FROM scheme THEN
    DELETE FROM public.cx_tournament_standings WHERE "tournamentId"=t.id AND source='computed';
  END IF;
  SELECT to_jsonb(x) INTO saved FROM public.cx_tournaments x WHERE id=t.id;
  INSERT INTO private.cx_change_log(operation,before,after) VALUES('save_tournament',previous,saved);
  RETURN t.id;
END $$;
REVOKE ALL ON FUNCTION public.cx_save_tournament(jsonb) FROM PUBLIC,anon,authenticated,service_role,cc_results_worker;
GRANT EXECUTE ON FUNCTION public.cx_save_tournament(jsonb) TO authenticated;
