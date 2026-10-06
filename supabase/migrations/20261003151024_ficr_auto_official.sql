-- FICR publica la llegada a medida que entran corredores (fuente progresiva):
-- se incorpora a las fuentes que se oficializan solas tras 30 minutos de
-- lecturas estables posteriores a la meta. El captador declara como censo la
-- lista de corredores de FICR en la carrera de un día y en la primera tappa.
-- CREATE OR REPLACE conserva propietario y privilegios de la función.
CREATE OR REPLACE FUNCTION private.result_source_is_live(source text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  SELECT lower(source) = ANY(ARRAY['tissot','matsport','raceresult','sts','livetiming','sportsoft',
    'timing.ee','evodata','infocity','aso','manual_timing','chronohr','maneffic','domtel','ficr']);
$function$;
