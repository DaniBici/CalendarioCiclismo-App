-- ─────────────────────────────────────────────────────────────────────────────
--  131 — RPC startlist_counts(): equipos y corredores por carrera
--
--  PROBLEMA: el generador de páginas OG pedía los conteos con funciones de
--  agregado de PostgREST:
--      startlist_teams?select=raceId,count()
--  y el proyecto las tiene DESHABILITADAS (db-aggregates-enabled = false, que es
--  el default de Supabase: evita que anon lance agregados arbitrarios sobre
--  cualquier tabla legible). La llamada devolvía siempre
--  `PGRST123: Use of aggregate functions is not allowed`, el generador lo
--  capturaba como aviso y las 802 páginas de /inscritos/ salían con la
--  descripción genérica ("Lista de equipos y corredores…") en vez de la buena
--  ("Lista de 22 equipos y 154 corredores inscritos…").
--
--  Fallo MUDO y antiguo: no venía de la migración a Pages por artifact — se
--  comprobó comparando los logs del og-pages.yml viejo, que fallaba igual.
--
--  SOLUCIÓN: agregar en el servidor y devolver solo el resultado. Son ~410
--  filas (~15 KB en 1 petición) frente a las 52.582 que habría que traer para
--  contar en cliente (~2,3 MB en 53 peticiones).
--
--  SEGURIDAD — por qué NO es SECURITY DEFINER:
--  `anon` ya tiene SELECT sobre startlist_teams/startlist_riders con RLS activa
--  y política de lectura pública, así que puede contar estas filas de todos
--  modos, una a una. Con INVOKER la función corre con los permisos de quien
--  llama y la RLS se sigue aplicando: no concede nada nuevo, solo evita el
--  viaje de 2,3 MB. Y a diferencia de habilitar los agregados globalmente,
--  expone ESTE dato concreto y nada más.
--
--  El grant a `anon` es necesario: el generador se autentica con la anon key.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.startlist_counts()
RETURNS TABLE ("raceId" text, teams bigint, riders bigint)
LANGUAGE sql
SECURITY INVOKER
STABLE
SET search_path = ''
AS $$
  -- FULL OUTER JOIN: una carrera puede tener equipos sin corredores (startlist
  -- a medio curar) o corredores sin bloque de equipo. COALESCE a 0 en el lado
  -- que falte, para que el generador reciba siempre los dos números.
  SELECT
    COALESCE(t."raceId", r."raceId")            AS "raceId",
    COALESCE(t.n, 0)                            AS teams,
    COALESCE(r.n, 0)                            AS riders
  FROM (
    SELECT "raceId", count(*) AS n
    FROM public.startlist_teams
    WHERE "raceId" IS NOT NULL
    GROUP BY "raceId"
  ) t
  FULL OUTER JOIN (
    SELECT "raceId", count(*) AS n
    FROM public.startlist_riders
    WHERE "raceId" IS NOT NULL
    GROUP BY "raceId"
  ) r ON r."raceId" = t."raceId";
$$;

COMMENT ON FUNCTION public.startlist_counts() IS
  'Equipos y corredores por carrera, para las descripciones SEO de /inscritos/. '
  'Agrega en el servidor porque los agregados de PostgREST están deshabilitados. '
  'SECURITY INVOKER: respeta la RLS de startlist_teams/startlist_riders.';

REVOKE ALL ON FUNCTION public.startlist_counts() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.startlist_counts() TO anon, authenticated, service_role;
