-- Índice para la FK y eliminación de políticas SELECT redundantes. Las políticas
-- públicas de lectura ya incluyen al rol del watcher; los GRANT de tabla siguen
-- limitando su acceso efectivo.

CREATE INDEX broadcast_source_links_race_day_idx
  ON private.broadcast_source_links(race_day_id);

DROP POLICY cc_broadcasts_worker_read_races ON public.races;
DROP POLICY cc_broadcasts_worker_read_race_days ON public.race_days;
DROP POLICY cc_broadcasts_worker_read_broadcasts ON public.broadcasts;
