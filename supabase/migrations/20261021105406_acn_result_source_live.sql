-- ACN Timing publica cada llegada en directo (fuente progresiva): se incorpora
-- a las fuentes que muestran «actualizándose» dentro de la ventana y se
-- oficializan solas tras 30 minutos de lecturas estables posteriores a la meta.
-- El captador omite los DNF provisionales (ACN marca DNF a quien aún no ha
-- llegado), de modo que la lista de inscritos, censo de la carrera de un día,
-- impide el cierre mientras falten corredores.
-- CREATE OR REPLACE conserva propietario y privilegios de la función.
CREATE OR REPLACE FUNCTION private.result_source_is_live(source text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  SELECT lower(source) = ANY(ARRAY['tissot','matsport','raceresult','sts','livetiming','sportsoft',
    'timing.ee','evodata','infocity','aso','manual_timing','chronohr','maneffic','domtel','ficr','lapclip','acn']);
$function$;
