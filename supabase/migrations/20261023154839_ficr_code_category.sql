-- FICR reúne a veces varias categorías en una misma carrera (Campeonato de
-- Italia CRI 2026: Juniores, sub-23 y Donne Elite/sub-23 en el recorrido de
-- 19,7 km). ficrCode admite un cuarto segmento con el código de categoría de
-- FICR (UN, DE, DU…) que filtra la lista de corredores y la llegada. Solo
-- cambia un CHECK: sin objetos nuevos ni GRANT.
ALTER TABLE public.race_uci_links
  DROP CONSTRAINT IF EXISTS chk_race_uci_links_ficr_code;

ALTER TABLE public.race_uci_links
  ADD CONSTRAINT chk_race_uci_links_ficr_code
  CHECK (source <> 'ficr'
    OR "ficrCode" ~ '^20[0-9]{2}/[1-9][0-9]{0,3}/[1-9][0-9]{0,5}(/[A-Z0-9]{1,6})?$');

COMMENT ON COLUMN public.race_uci_links."ficrCode" IS
  'FICR: <año>/<equipo cronometrador>/<carrera>[/<categoría>]; p. ej. 2026/102/10 (Il Lombardia sub23 2026) o 2026/46/3/UN (sub-23 masculino de una CRI con varias categorías).';
