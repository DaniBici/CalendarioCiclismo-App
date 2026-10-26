-- Orden canónico de los IRM al final de cada clasificación de una carrera:
--   0 clasificados (sin IRM, o con LAP/OVL/REL y puesto)
--   1 DF, NR y LAP/OVL/REL sin puesto (la prueba terminó pero no hay resultado)
--   2 DSQ (expulsados)  3 OTL (fuera de control)  4 DNF/ABD (no terminó)  5 DNS (no salió)
--   6 cualquier otro código
-- El grupo depende del IRM y no del puesto: una general puede dejar a los retirados con un
-- puesto de relleno. Dentro de un grupo de IRM, los corredores del mismo equipo van juntos
-- (equipos por orden de primera aparición; el resto conserva el orden previo). El equipo sale
-- del override de la fila, de la startlist por dorsal o por corredor, o del equipo de la fuente.
CREATE OR REPLACE FUNCTION private.order_uci_irm_results(p_race_id text)
RETURNS integer
LANGUAGE plpgsql
SET search_path TO ''
AS $function$
DECLARE
  v_updated integer;
BEGIN
  WITH base AS (
    SELECT r.id, r."stageRef", r."sortOrder",
      CASE
        WHEN r.irm IS NULL OR (r.irm IN ('LAP','OVL','REL') AND r.rank IS NOT NULL) THEN 0
        WHEN r.irm IN ('DF','NR','LAP','OVL','REL') THEN 1
        WHEN r.irm = 'DSQ' THEN 2
        WHEN r.irm = 'OTL' THEN 3
        WHEN r.irm IN ('DNF','ABD') THEN 4
        WHEN r.irm = 'DNS' THEN 5
        ELSE 6
      END AS g,
      coalesce(
        r."teamId",
        sr."canonTeamId",
        'st:' || sr."startlistTeamId",
        'src:' || lower(coalesce(r."sourceTeamCode", r."sourceTeamName"))
      ) AS tk
    FROM public.race_uci_results r
    LEFT JOIN LATERAL (
      SELECT stt."teamId" AS "canonTeamId", stt.id AS "startlistTeamId"
      FROM public.startlist_riders s
      JOIN public.startlist_teams stt ON stt.id = s."teamId"
      WHERE s."raceId" = r."raceId"
        AND ((r.bib ~ '^[0-9]+$' AND s.dorsal = r.bib::integer)
          OR (r."globalRiderId" IS NOT NULL AND s."globalRiderId" = r."globalRiderId"))
      ORDER BY (r.bib ~ '^[0-9]+$' AND s.dorsal = r.bib::integer) DESC, s.id
      LIMIT 1
    ) sr ON true
    WHERE r."raceId" = p_race_id
  ), keyed AS (
    SELECT *,
      CASE WHEN g = 0 OR tk IS NULL THEN "sortOrder"
           ELSE min("sortOrder") OVER (PARTITION BY "stageRef", g, tk) END AS tpos
    FROM base
  ), ranked AS (
    SELECT id, "stageRef", "sortOrder", g,
      row_number() OVER (PARTITION BY "stageRef" ORDER BY g, tpos, tk, "sortOrder", id) - 1 AS new_order,
      row_number() OVER (PARTITION BY "stageRef" ORDER BY "sortOrder", id) - 1 AS old_order,
      count(*) OVER (PARTITION BY "stageRef", "sortOrder") AS same_order
    FROM keyed
  ), pending AS (
    SELECT "stageRef" FROM ranked
    GROUP BY "stageRef"
    HAVING bool_or(new_order <> old_order)
        OR (bool_or(g >= 1) AND bool_or(same_order > 1))
  )
  UPDATE public.race_uci_results r
     SET "sortOrder" = x.new_order
  FROM ranked x
  WHERE r.id = x.id
    AND x."stageRef" IN (SELECT "stageRef" FROM pending)
    AND r."sortOrder" IS DISTINCT FROM x.new_order;

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated;
END;
$function$;

REVOKE ALL ON FUNCTION private.order_uci_irm_results(text) FROM PUBLIC, anon, authenticated;

-- resolve_uci_results ordena los IRM tras enlazar corredores: la ejecutan el cron, los
-- fetchers y el panel después de cada carga, así el orden no depende de la fuente.
CREATE OR REPLACE FUNCTION public.resolve_uci_results(p_race_id text)
 RETURNS TABLE(matched integer, unresolved integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  PERFORM private.assert_startlist_import_admin();

  WITH src AS (
    SELECT r.id, sr."globalRiderId" AS gid
    FROM public.race_uci_results r
    JOIN public.race_uci_stages st ON st.id = r."stageRef"
    LEFT JOIN public.startlist_riders sr
      ON sr."raceId" = p_race_id
     AND r.bib ~ '^[0-9]+$'
     AND sr.dorsal = r.bib::integer
     AND sr."globalRiderId" IS NOT NULL
    WHERE r."raceId" = p_race_id
      AND st."isTeamEvent" = false
  )
  UPDATE public.race_uci_results r
     SET "globalRiderId" = src.gid
  FROM src
  WHERE r.id = src.id
    AND src.gid IS NOT NULL
    AND r."globalRiderId" IS DISTINCT FROM src.gid;

  PERFORM private.order_uci_irm_results(p_race_id);

  SELECT
    count(*) FILTER (WHERE r."globalRiderId" IS NOT NULL)::integer,
    count(*) FILTER (WHERE r."globalRiderId" IS NULL)::integer
  INTO matched, unresolved
  FROM public.race_uci_results r
  JOIN public.race_uci_stages st ON st.id = r."stageRef"
  WHERE r."raceId" = p_race_id
    AND st."isTeamEvent" = false;

  RETURN NEXT;
END;
$function$;
