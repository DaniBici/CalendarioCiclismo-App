-- 112_race_uci_results_team_override.sql
--
-- Editor de Resultados del panel — override manual de corredor y equipo.
--
-- Hasta ahora `race_uci_results` no guardaba el equipo: la web/apps lo resuelven
-- SIEMPRE en vivo por dorsal (bib → startlist_riders → startlist_teams → teams),
-- con un fallback por globalRiderId (→ riders_*.currentTeamId). Cuando el dorsal
-- NO casa con la startlist (corredor fuera de inscritos, CN sin startlist, dorsal
-- a 0) la fila sale sin equipo y no había forma de fijarlo a mano.
--
-- (A) Nueva columna `teamId` = OVERRIDE manual de equipo. Cuando está poblada,
--     gana a la resolución por dorsal/globalRiderId en el render (web + apps).
--     La escribe SOLO el panel (editor de clasificación). El pipeline de volcado
--     (uci-results-upsert.mjs) la deja a NULL → cero impacto en el flujo
--     automático. Como el guardado del panel hace DELETE+INSERT de las filas, el
--     teamId se re-inserta en cada guardado y persiste sin pasos extra. Sin índice
--     (solo se lee junto al resto de la fila, ya indexada por stageRef).
--
-- (B) Fix de resolve_uci_results para no BORRAR un globalRiderId casado a mano.
--     El RPC re-sincroniza globalRiderId por dorsal y corre al final de cada
--     guardado del panel y desde el cron. Hasta ahora el LEFT JOIN dejaba
--     gid = NULL cuando el dorsal no casaba con la startlist, y el
--     "UPDATE ... WHERE globalRiderId IS DISTINCT FROM src.gid" PONÍA A NULL ese
--     globalRiderId — borrando el corredor que el panel acababa de fijar a mano
--     (que es justo el caso en que el dorsal no casa). Se añade
--     "AND src.gid IS NOT NULL" al WHERE: el RPC sigue ENLAZANDO/corrigiendo por
--     dorsal cuando hay match, pero NUNCA borra un globalRiderId sin match. El
--     LEFT JOIN se conserva (no afecta al recuento estable, que es aparte).
--
-- Sin flag `manualRider` (decisión de producto): el override de equipo es la
-- garantía dura; el corredor casado a mano sobrevive porque, sin dorsal casable,
-- el RPC ya no lo toca (este fix).
--
-- Sigue a la 111. La siguiente migración es la 113.

-- ─── (A) Override de equipo ────────────────────────────────────────
ALTER TABLE public.race_uci_results
  ADD COLUMN IF NOT EXISTS "teamId" TEXT;

COMMENT ON COLUMN public.race_uci_results."teamId" IS
  'Override MANUAL de equipo (referencia a teams.id), fijado desde el panel. Cuando NO es NULL, gana a la resolución por dorsal/globalRiderId en el render. El pipeline de volcado lo deja a NULL.';

-- ─── (B) resolve_uci_results — no borrar globalRiderId sin match por dorsal ──
CREATE OR REPLACE FUNCTION public.resolve_uci_results(p_race_id text)
RETURNS TABLE (matched int, unresolved int)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  WITH src AS (
    SELECT r.id,
           sr."globalRiderId" AS gid
    FROM public.race_uci_results r
    JOIN public.race_uci_stages st ON st.id = r."stageRef"
    LEFT JOIN public.startlist_riders sr
      ON sr."raceId" = p_race_id
     AND r.bib ~ '^[0-9]+$'
     AND sr.dorsal = r.bib::int
     AND sr."globalRiderId" IS NOT NULL
    WHERE r."raceId" = p_race_id
      AND st."isTeamEvent" = false
  )
  UPDATE public.race_uci_results r
     SET "globalRiderId" = src.gid
  FROM src
  WHERE r.id = src.id
    AND src.gid IS NOT NULL                            -- nunca borrar: solo enlazar por dorsal con match
    AND r."globalRiderId" IS DISTINCT FROM src.gid;    -- no escribir si no cambia

  -- Recuento estable sobre el estado final (barato: índice por raceId).
  SELECT
    COUNT(*) FILTER (WHERE r."globalRiderId" IS NOT NULL)::int,
    COUNT(*) FILTER (WHERE r."globalRiderId" IS NULL)::int
  INTO matched, unresolved
  FROM public.race_uci_results r
  JOIN public.race_uci_stages st ON st.id = r."stageRef"
  WHERE r."raceId" = p_race_id
    AND st."isTeamEvent" = false;

  RETURN NEXT;
END $$;

REVOKE ALL ON FUNCTION public.resolve_uci_results(text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.resolve_uci_results(text) TO authenticated, service_role;
