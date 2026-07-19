-- ═══════════════════════════════════════════════════════════════════
--  Fase 3 (resultados-web, PLAN-resultados-web.md §3): enlazar los
--  resultados UCI a globalRiderId POR DORSAL + adelgazar la fila a lo
--  genuinamente suyo (dorsal + dato de clasificación).
--
--  TESIS (verificada sobre el Dauphiné 2026, 476/476 filas): la fila de
--  resultado NO necesita guardar el corredor. Dentro de una carrera el
--  DORSAL es único e inequívoco, y la startlist (startlist_riders) ya está
--  curada y enlazada a globalRiderId. Por tanto:
--   · El corredor se reconstruye por dorsal → globalRiderId → riders_men/women.
--   · El equipo (por fecha) se reconstruye por dorsal → startlist_teams → teams.
--   · El país / fecha-nac viven en la ficha del corredor.
--  → firstName/lastName/teamName/isoCode2/birthDate en race_uci_results eran
--    duplicación del corredor en cada fila de cada clasificación. Se eliminan.
--    Se conserva riderDisplay SOLO como fallback de visualización cuando el
--    dorsal no casa (carrera sin startlist cargada): la fila nunca queda muda.
--
--  Esta migración hace dos cosas:
--    (A) DROP de las columnas redundantes de race_uci_results.
--    (B) CREATE de la RPC resolve_uci_results(raceId) que rellena globalRiderId
--        por dorsal (la "reconstrucción" de la Fase 3).
--
--  Sigue a la 081 (que creó las tablas). La siguiente migración es la 083.
-- ═══════════════════════════════════════════════════════════════════

-- ─── (A) Adelgazar race_uci_results ────────────────────────────────
-- Ningún índice depende de estas columnas (los índices son sobre id, stageRef,
-- raceId, globalRiderId). riderDisplay se queda (fallback). El upsert deja de
-- escribirlas (ver uci-results-upsert.mjs en el mismo commit).
ALTER TABLE public.race_uci_results
  DROP COLUMN IF EXISTS "firstName",
  DROP COLUMN IF EXISTS "lastName",
  DROP COLUMN IF EXISTS "teamName",
  DROP COLUMN IF EXISTS "isoCode2",
  DROP COLUMN IF EXISTS "birthDate";

COMMENT ON COLUMN public.race_uci_results."riderDisplay" IS
  'Nombre tal cual lo publica la UCI ("CHARMIG Anthon"). Fallback de visualización: solo se muestra cuando globalRiderId es NULL (carrera sin startlist). Con globalRiderId, el nombre/equipo/país se resuelven por la ficha del corredor.';
COMMENT ON COLUMN public.race_uci_results.bib IS
  'Dorsal. Clave maestra: enlaza con startlist_riders.dorsal (de la misma raceId) → globalRiderId. La reconstruye resolve_uci_results().';

-- ─── (B) RPC resolve_uci_results — enlace por dorsal ───────────────
--  Enlaza race_uci_results.globalRiderId desde la startlist curada por
--  bib(resultado) → dorsal(startlist) → globalRiderId. Ignora el nombre por
--  completo. 100% de cobertura sin matching probabilístico.
--
--  SALVAGUARDAS:
--   · Solo eventos INDIVIDUALES (race_uci_stages.isTeamEvent = false). En las
--     clasificaciones por equipos el "bib" puede ser un dorsal de equipo → no
--     se tocan (globalRiderId queda NULL a propósito).
--   · Solo bib numérico con un dorsal homónimo en la startlist que tenga
--     globalRiderId. Lo que no case (carrera sin startlist, bib raro) queda
--     NULL y se muestra por riderDisplay.
--   · NO crea fichas: el alta del catálogo es curada (startlists/panel). Aquí
--     solo se ENLAZA lo ya existente vía la startlist.
--
--  IDEMPOTENTE / RE-EJECUTABLE: la startlist es la verdad. Re-sincroniza
--  globalRiderId al estado actual de la startlist — propaga correcciones del
--  panel y limpia a NULL una fila cuyo dorsal ya no exista. Pensada para
--  llamarse al final de cada upsert y desde el cron. El género no interviene
--  (el dorsal ya apunta al rider correcto masc/fem en la startlist).
--
--  Devuelve el recuento ESTABLE final (enlazadas / sin enlazar) de las filas
--  individuales de la carrera, no solo las que cambiaron.
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
    AND r."globalRiderId" IS DISTINCT FROM src.gid;   -- no escribir si no cambia

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

-- Mismos grants que resolve_riders: solo usuarios autenticados + service_role
-- (cron/backfill via service key o pooler; panel via sesión authed).
REVOKE ALL ON FUNCTION public.resolve_uci_results(text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.resolve_uci_results(text) TO authenticated, service_role;
