-- Precisión del nacimiento en fichas CX.
--
-- Muchas fuentes de ciclocross nacional solo permiten fijar el año de nacimiento
-- (perfiles que publican el año o categorías por edad acreditadas en varias temporadas).
-- El año basta para la edad UCI de las generales, pero guardarlo como fecha exacta
-- impediría enlazar la ficha cuando una fuente publique la fecha real. Con precisión
-- 'year', birthDate guarda el 1 de enero de ese año y cualquier fecha del mismo año es
-- compatible en la ingesta y en el resolvedor JS.

ALTER TABLE public.cx_riders_men
  ADD COLUMN "birthDatePrecision" text NOT NULL DEFAULT 'day',
  ADD CONSTRAINT cx_riders_men_birth_date_precision_check CHECK (
    "birthDatePrecision"='day' OR ("birthDatePrecision"='year' AND "birthDate" IS NOT NULL
      AND date_part('month',"birthDate")=1 AND date_part('day',"birthDate")=1));

ALTER TABLE public.cx_riders_women
  ADD COLUMN "birthDatePrecision" text NOT NULL DEFAULT 'day',
  ADD CONSTRAINT cx_riders_women_birth_date_precision_check CHECK (
    "birthDatePrecision"='day' OR ("birthDatePrecision"='year' AND "birthDate" IS NOT NULL
      AND date_part('month',"birthDate")=1 AND date_part('day',"birthDate")=1));

DO $patch$
DECLARE
  v_def text; v_count integer;
  v_old text:='(dob IS NULL OR "birthDate" IS NULL OR "birthDate"=dob)';
  v_new text:='(dob IS NULL OR "birthDate" IS NULL OR "birthDate"=dob OR ("birthDatePrecision"=''year'' AND date_part(''year'',"birthDate")=date_part(''year'',dob)))';
BEGIN
  v_def:=pg_get_functiondef('public.cx_ingest_results(text,text,jsonb,text,jsonb)'::regprocedure);
  v_count:=(length(v_def)-length(replace(v_def,v_old,'')))/length(v_old);
  IF v_count<>4 THEN
    RAISE EXCEPTION 'cx_ingest_results: se esperaban 4 comparaciones de nacimiento y hay %',v_count;
  END IF;
  EXECUTE replace(v_def,v_old,v_new);
END
$patch$;
