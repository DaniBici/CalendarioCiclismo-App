-- Fichas CX sin fecha de nacimiento.
--
-- El ciclocross nacional publica a menudo corredores sin perfil con fecha verificable.
-- La ingesta crea la ficha ausente con nacionalidad ISO-2 válida aunque falte el
-- nacimiento (se completa después), y una fila sin nacimiento es compatible con las
-- fichas existentes del mismo nombre, igual que una ficha sin nacimiento lo es con
-- cualquier fila. Un nacimiento presente pero fuera de rango sigue sin resolverse.

DO $patch$
DECLARE
  v_def text; v_count integer;
  v_old_dob text:='IF dob IS NULL OR dob<''1900-01-01''::date OR dob>current_date THEN';
  v_new_dob text:='IF dob IS NOT NULL AND (dob<''1900-01-01''::date OR dob>current_date) THEN';
  v_old_cmp text:='("birthDate" IS NULL OR "birthDate"=dob)';
  v_new_cmp text:='(dob IS NULL OR "birthDate" IS NULL OR "birthDate"=dob)';
BEGIN
  v_def:=pg_get_functiondef('public.cx_ingest_results(text,text,jsonb,text,jsonb)'::regprocedure);
  v_count:=(length(v_def)-length(replace(v_def,v_old_dob,'')))/length(v_old_dob);
  IF v_count<>1 THEN
    RAISE EXCEPTION 'cx_ingest_results: se esperaba 1 exigencia de nacimiento y hay %',v_count;
  END IF;
  v_count:=(length(v_def)-length(replace(v_def,v_old_cmp,'')))/length(v_old_cmp);
  IF v_count<>4 THEN
    RAISE EXCEPTION 'cx_ingest_results: se esperaban 4 comparaciones de nacimiento y hay %',v_count;
  END IF;
  EXECUTE replace(replace(v_def,v_old_dob,v_new_dob),v_old_cmp,v_new_cmp);
END
$patch$;
