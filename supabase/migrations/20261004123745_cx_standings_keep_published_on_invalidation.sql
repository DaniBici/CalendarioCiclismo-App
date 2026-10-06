-- Generales CX continuas: una invalidación (cambio de resultados, manga, carrera,
-- identidad o reglas) ya no retira la última general publicada ni cambia su
-- estado. Solo encola el recálculo; cx_publish_standings sustituye las filas de
-- forma atómica cuando el worker publica. Así la general no desaparece de la web
-- y las apps entre la carga de resultados y el recálculo.
-- Retirar una categoría del esquema sigue borrando sus filas calculadas
-- (rama cx_tournaments de private.cx_standings_changed, sin cambios).
CREATE OR REPLACE FUNCTION private.cx_enqueue_standings(p_tournament_id text, p_category text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE tournament public.cx_tournaments; target text;
BEGIN
  SELECT * INTO tournament FROM public.cx_tournaments WHERE id=p_tournament_id;
  IF NOT FOUND THEN RETURN; END IF;
  FOR target IN SELECT key FROM jsonb_each(coalesce(tournament."pointsScheme"->'categories','{}'))
    WHERE key IN ('ME','WE','MU','WU','MJ','WJ') AND (p_category IS NULL OR key=p_category
      OR value#>>'{extras,derived,fromCategory}'=p_category) LOOP
    -- La fila de estado existe desde la primera invalidación; su estado y sus
    -- filas publicadas se conservan hasta la nueva publicación.
    INSERT INTO public.cx_standings_state("tournamentId","seasonKey",category,status)
      VALUES(p_tournament_id,tournament."seasonKey",target,'pending')
      ON CONFLICT ("tournamentId",category) DO NOTHING;
    INSERT INTO private.cx_standings_queue("tournamentId",category) VALUES(p_tournament_id,target)
      ON CONFLICT ("tournamentId",category) DO UPDATE SET status='pending',generation=cx_standings_queue.generation+1,
        "requestedAt"=now(),"claimedAt"=NULL,"finishedAt"=NULL,"lastError"=NULL;
  END LOOP;
END $function$;

REVOKE ALL ON FUNCTION private.cx_enqueue_standings(text,text) FROM PUBLIC,anon,authenticated,service_role,cc_results_worker;

-- Un cambio de ID de ficha renombra la referencia en la general conservada; el
-- recálculo encolado la sustituye después.
CREATE OR REPLACE FUNCTION private.cx_standings_identity_id_changed()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE target text; source_category text;
BEGIN
  IF OLD.id IS NOT DISTINCT FROM NEW.id THEN RETURN NULL; END IF;
  UPDATE public.cx_tournament_standings SET "globalRiderId"=NEW.id
    WHERE "globalRiderId"=OLD.id AND left(category,1)=CASE WHEN TG_TABLE_NAME='cx_riders_men' THEN 'M' ELSE 'W' END;
  FOR target,source_category IN SELECT DISTINCT r."tournamentId",x.category FROM public.cx_results x
    JOIN public.cx_races r ON r.id=x."raceId" WHERE r."tournamentId" IS NOT NULL
    AND x."globalRiderId" IN (OLD.id,NEW.id)
    AND left(x.category,1)=CASE WHEN TG_TABLE_NAME='cx_riders_men' THEN 'M' ELSE 'W' END LOOP
    PERFORM private.cx_enqueue_standings(target,source_category);
  END LOOP;
  RETURN NULL;
END $function$;

REVOKE ALL ON FUNCTION private.cx_standings_identity_id_changed() FROM PUBLIC,anon,authenticated,service_role,cc_results_worker;
