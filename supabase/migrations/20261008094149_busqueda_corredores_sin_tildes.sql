-- Búsqueda de corredores insensible a tildes en el panel. "searchName" pliega
-- nombre, apellidos y otros nombres con public.fold_name; el panel filtra con
-- ilike un término plegado por condición. Columna ordinaria mantenida por
-- trigger, no generada: las escrituras que reenvían la fila completa siguen
-- aceptándose y el valor enviado se recalcula. El relleno inicial usa una
-- expresión generada que se retira a continuación, sin disparar triggers de fila.

ALTER TABLE public.riders_men ADD COLUMN "searchName" text
  GENERATED ALWAYS AS (public.fold_name(coalesce("firstName", '') || ' ' || coalesce("lastName", '') || ' ' || coalesce("otherNames", ''))) STORED;
ALTER TABLE public.riders_men ALTER COLUMN "searchName" DROP EXPRESSION;

ALTER TABLE public.riders_women ADD COLUMN "searchName" text
  GENERATED ALWAYS AS (public.fold_name(coalesce("firstName", '') || ' ' || coalesce("lastName", '') || ' ' || coalesce("otherNames", ''))) STORED;
ALTER TABLE public.riders_women ALTER COLUMN "searchName" DROP EXPRESSION;

ALTER TABLE public.cx_riders_men ADD COLUMN "searchName" text
  GENERATED ALWAYS AS (public.fold_name(coalesce("firstName", '') || ' ' || coalesce("lastName", '') || ' ' || coalesce("otherNames", ''))) STORED;
ALTER TABLE public.cx_riders_men ALTER COLUMN "searchName" DROP EXPRESSION;

ALTER TABLE public.cx_riders_women ADD COLUMN "searchName" text
  GENERATED ALWAYS AS (public.fold_name(coalesce("firstName", '') || ' ' || coalesce("lastName", '') || ' ' || coalesce("otherNames", ''))) STORED;
ALTER TABLE public.cx_riders_women ALTER COLUMN "searchName" DROP EXPRESSION;

CREATE FUNCTION private.set_rider_search_name()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO ''
AS $$
BEGIN
  NEW."searchName" := public.fold_name(coalesce(NEW."firstName", '') || ' ' || coalesce(NEW."lastName", '') || ' ' || coalesce(NEW."otherNames", ''));
  RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION private.set_rider_search_name() FROM PUBLIC;

-- El nombre ordena el trigger después de normalize_cjk_rider_name y
-- set_identity_key_*, que pueden reescribir firstName y lastName.
CREATE TRIGGER set_search_name BEFORE INSERT OR UPDATE ON public.riders_men
  FOR EACH ROW EXECUTE FUNCTION private.set_rider_search_name();
CREATE TRIGGER set_search_name BEFORE INSERT OR UPDATE ON public.riders_women
  FOR EACH ROW EXECUTE FUNCTION private.set_rider_search_name();
CREATE TRIGGER set_search_name BEFORE INSERT OR UPDATE ON public.cx_riders_men
  FOR EACH ROW EXECUTE FUNCTION private.set_rider_search_name();
CREATE TRIGGER set_search_name BEFORE INSERT OR UPDATE ON public.cx_riders_women
  FOR EACH ROW EXECUTE FUNCTION private.set_rider_search_name();
