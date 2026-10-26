-- ACN publica la línea Elite y sub-23 de un campeonato en una sola tabla y
-- marca con «*» la inscripción sub-23. acnCode admite un cuarto segmento que
-- filtra la categoría: <eventId>/<ctx>/<clave>/elite o /u23. Solo cambia un
-- CHECK: sin objetos nuevos ni GRANT.
ALTER TABLE public.race_uci_links
  DROP CONSTRAINT IF EXISTS chk_race_uci_links_acn_code;

ALTER TABLE public.race_uci_links
  ADD CONSTRAINT chk_race_uci_links_acn_code
  CHECK (source <> 'acn'
    OR "acnCode" ~ '^[0-9]{6,20}/[0-9]{8}_[A-Za-z0-9_-]+/[A-Za-z0-9_]+(/(elite|u23))?$');

COMMENT ON COLUMN public.race_uci_links."acnCode" IS
  'ACN Timing: <eventId>/<ctx>/<clave de la tabla>[/elite|/u23]; p. ej. 2156365640493136/20261021_cac/ITTRES1 (CRI) o 2156365640493136/20261021_cac/IRRES11/elite (línea Elite de una tabla conjunta con sub-23).';
