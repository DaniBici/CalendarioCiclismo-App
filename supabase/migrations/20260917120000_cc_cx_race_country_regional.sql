-- La bandera de una prueba CX admite los códigos regionales es-ct (Catalunya)
-- y es-pv (País Vasco), presentes en el set de banderas de las tres
-- plataformas. El resto de tablas CX conservan ISO2 de dos letras.
--
-- El CHECK original se creó como columna inline y Postgres lo nombró con la
-- grafía de la columna ("cx_races_countryCode_check"), por eso se cita.
ALTER TABLE public.cx_races
    DROP CONSTRAINT IF EXISTS "cx_races_countryCode_check";

ALTER TABLE public.cx_races
    ADD CONSTRAINT cx_races_country_code_check
    CHECK ("countryCode" ~ '^[A-Z]{2}(-[A-Z]{2})?$');
