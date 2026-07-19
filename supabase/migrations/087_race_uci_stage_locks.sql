-- ═══════════════════════════════════════════════════════════════════
--  Bloqueo manual de clasificaciones UCI (pestaña "Resultados" del panel).
--
--  CONTEXTO. El cron de resultados (uci-results-today.yml cada 15 min +
--  uci-results-backlog.yml) re-sincroniza cada clasificación con DELETE por
--  stageRef + INSERT (uci-results-upsert.mjs): idempotente, la UCI manda.
--  Pero cuando Dani CORRIGE una clasificación desde el panel (editor de la
--  jornada → pestaña Resultados), esa corrección sería pisada en ≤15 min.
--
--  FIX. Columna "lockedAt" en race_uci_stages (la cabecera por etapa ×
--  clasificación). NULL = el cron sincroniza con normalidad; NOT NULL =
--  clasificación BLOQUEADA: el upsert salta tanto el UPDATE de la cabecera
--  como el DELETE+INSERT de sus filas (guardas en uci-results-upsert.mjs,
--  mismo commit). El panel la fija a now() al guardar una edición (o con el
--  candado manual) y la limpia al desbloquear.
--
--  Granularidad: por (etapa × clasificación) — bloquear la GC de la etapa 5
--  no congela el resto de la carrera.
--
--  Lo que NO bloquea (a propósito): resolve_uci_results / _by_name siguen
--  re-resolviendo globalRiderId por dorsal también en filas bloqueadas — solo
--  tocan el ENLACE al corredor (la startlist curada es la verdad), nunca los
--  datos de clasificación (rank/tiempo/gap/puntos/irm). Así una corrección de
--  startlist se propaga igual a clasificaciones bloqueadas.
--
--  Sin índice: el upsert y el panel acceden por PK (id = stageRef).
--
--  Sigue a la 086. La siguiente migración es la 088.
-- ═══════════════════════════════════════════════════════════════════

ALTER TABLE public.race_uci_stages
  ADD COLUMN IF NOT EXISTS "lockedAt" TIMESTAMPTZ;

COMMENT ON COLUMN public.race_uci_stages."lockedAt" IS
  'Bloqueo manual desde el panel (editor de jornada → pestaña Resultados). NULL = el cron '
  'sincroniza esta clasificación con la UCI; NOT NULL = bloqueada (el upsert del cron no toca '
  'ni esta cabecera ni sus race_uci_results). Se fija al guardar una corrección manual o con el '
  'candado; desbloquear (NULL) vuelve a dejar que el siguiente volcado del cron la sobreescriba.';
