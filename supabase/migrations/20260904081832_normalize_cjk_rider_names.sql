-- Respaldo específico y normalización de nombres con anotaciones CJK.
-- La reparación de datos usa un manifiesto local de ids; esta migración no hace backfill.
CREATE TABLE private.cjk_names_repair_20260904_backup (
  table_name text NOT NULL,
  row_id text NOT NULL,
  row_data jsonb NOT NULL,
  replacement jsonb NOT NULL,
  saved_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (table_name, row_id)
);
ALTER TABLE private.cjk_names_repair_20260904_backup ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE private.cjk_names_repair_20260904_backup FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON TABLE private.cjk_names_repair_20260904_backup TO service_role;

-- Solo elimina caracteres de los bloques Han, kana, hangul y anotaciones CJK.
-- No pliega diacríticos, cambia mayúsculas ni translitera nombres sin grafía latina.
CREATE FUNCTION public.remove_cjk_name_annotations(p_name text)
RETURNS text
LANGUAGE plpgsql IMMUTABLE STRICT
SET search_path = ''
AS $$
DECLARE
  cjk constant text := U&'[\1100-\11FF\2E80-\2FFF\3005-\3007\3021-\3029\3038-\303B\3040-\30FF\3100-\31FF\3400-\4DBF\4E00-\9FFF\A960-\A97F\AC00-\D7FF\F900-\FAFF\FF66-\FFDC\+01AFF0-\+01AFFF\+01B000-\+01B16F\+020000-\+03FFFF]';
BEGIN
  IF p_name !~ cjk THEN RETURN p_name; END IF;
  RETURN btrim(regexp_replace(regexp_replace(p_name, cjk, ' ', 'g'), '[[:space:]]+', ' ', 'g'));
END;
$$;
REVOKE ALL ON FUNCTION public.remove_cjk_name_annotations(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.remove_cjk_name_annotations(text) TO authenticated, service_role;

CREATE FUNCTION public.normalize_cjk_rider_name(p_first text, p_last text)
RETURNS TABLE ("firstName" text, "lastName" text)
LANGUAGE plpgsql IMMUTABLE
SET search_path = ''
AS $$
DECLARE
  clean_first text := public.remove_cjk_name_annotations(p_first);
  clean_last text := public.remove_cjk_name_annotations(p_last);
  surname text;
BEGIN
  IF clean_first IS NOT DISTINCT FROM p_first AND clean_last IS NOT DISTINCT FROM p_last THEN
    RETURN QUERY SELECT p_first, p_last;
    RETURN;
  END IF;
  -- Formato observado: firstName='TSAI 雅羽 Ya Yu', lastName='蔡'.
  -- Recolocar el apellido solo con marcador de mayúsculas y anotación intercalada.
  IF clean_last = '' AND clean_first ~ '^[A-Z]+[[:space:]]+[A-Z][a-z]' THEN
    surname := split_part(clean_first, ' ', 1);
    IF left(p_first, length(surname) + 1) = surname || ' '
       AND public.remove_cjk_name_annotations(split_part(p_first, ' ', 2)) = '' THEN
      clean_first := substr(clean_first, length(surname) + 2);
      clean_last := initcap(surname);
    END IF;
  END IF;
  IF coalesce(public.fold_name(clean_first), '') !~ '[a-z]'
     OR coalesce(public.fold_name(clean_last), '') !~ '[a-z]'
     OR public.compute_identity_key(p_first, p_last) IS DISTINCT FROM
        public.compute_identity_key(clean_first, clean_last) THEN
    RAISE EXCEPTION USING ERRCODE = '23514',
      MESSAGE = 'Nombre CJK sin nombre y apellido latinos completos; revisar la grafía de la fuente.';
  END IF;
  RETURN QUERY SELECT clean_first, clean_last;
END;
$$;
REVOKE ALL ON FUNCTION public.normalize_cjk_rider_name(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.normalize_cjk_rider_name(text, text) TO authenticated, service_role;

CREATE FUNCTION public.guard_cjk_rider_name()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  SELECT n."firstName", n."lastName" INTO NEW."firstName", NEW."lastName"
  FROM public.normalize_cjk_rider_name(NEW."firstName", NEW."lastName") n;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_cjk_rider_name() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.guard_cjk_rider_name() TO service_role;

-- Debe ejecutarse antes de set_identity_key_* (orden alfabético de PostgreSQL).
CREATE TRIGGER normalize_cjk_rider_name
  BEFORE INSERT OR UPDATE OF "firstName", "lastName" ON public.riders_men
  FOR EACH ROW EXECUTE FUNCTION public.guard_cjk_rider_name();
CREATE TRIGGER normalize_cjk_rider_name
  BEFORE INSERT OR UPDATE OF "firstName", "lastName" ON public.riders_women
  FOR EACH ROW EXECUTE FUNCTION public.guard_cjk_rider_name();
CREATE TRIGGER normalize_cjk_rider_name
  BEFORE INSERT OR UPDATE OF "firstName", "lastName" ON public.startlist_riders
  FOR EACH ROW EXECUTE FUNCTION public.guard_cjk_rider_name();

CREATE FUNCTION public.guard_cjk_rider_display()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  original text;
  cleaned text;
BEGIN
  original := to_jsonb(NEW)->>TG_ARGV[0];
  cleaned := public.remove_cjk_name_annotations(original);
  IF cleaned IS NOT DISTINCT FROM original THEN RETURN NEW; END IF;
  -- riderDisplay también guarda nombres de equipos: quedan fuera del contrato.
  IF TG_TABLE_NAME = 'race_uci_results' THEN
    IF EXISTS (SELECT 1 FROM public.race_uci_stages s
               WHERE s.id = NEW."stageRef" AND s."classKind" = 'teams') THEN
      RETURN NEW;
    END IF;
  ELSIF NEW.dorsal = 0 THEN
    RETURN NEW; -- Orden de salida por equipos (CRE).
  END IF;
  IF coalesce(public.fold_name(cleaned), '') !~ '[a-z]+ [a-z]+' THEN
    RAISE EXCEPTION USING ERRCODE = '23514',
      MESSAGE = 'Nombre CJK sin grafía latina completa; revisar la fuente antes de importar.';
  END IF;
  NEW := jsonb_populate_record(NEW, jsonb_build_object(TG_ARGV[0], cleaned));
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_cjk_rider_display() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.guard_cjk_rider_display() TO service_role;
CREATE TRIGGER normalize_cjk_rider_display
  BEFORE INSERT OR UPDATE OF "riderDisplay" ON public.race_uci_results
  FOR EACH ROW EXECUTE FUNCTION public.guard_cjk_rider_display('riderDisplay');
CREATE TRIGGER normalize_cjk_rider_display
  BEFORE INSERT OR UPDATE OF "riderName" ON public.start_order_entries
  FOR EACH ROW EXECUTE FUNCTION public.guard_cjk_rider_display('riderName');


-- La resolución sin dorsal compara el display exacto. Normalizar el argumento
-- con la misma función evita romper ese enlace cuando el trigger limpia la fila.
-- Reescritura acotada: conservar íntegros los controles vigentes del resolutor.
DO $migration$
DECLARE
  definition text := pg_get_functiondef('public.resolve_uci_results_by_name(text,text,jsonb)'::regprocedure);
  before_line constant text := 'v_display := NULLIF(v_row->>''display'', '''');';
  after_line constant text := 'v_display := NULLIF(public.remove_cjk_name_annotations(v_row->>''display''), '''');';
BEGIN
  IF strpos(definition, before_line) = 0 THEN
    RAISE EXCEPTION 'Ha cambiado resolve_uci_results_by_name; revisar la normalización CJK antes de migrar.';
  END IF;
  EXECUTE replace(definition, before_line, after_line);
END;
$migration$;
