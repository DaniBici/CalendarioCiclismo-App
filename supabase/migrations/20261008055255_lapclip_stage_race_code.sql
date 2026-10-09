-- LAPCLIP también cronometra vueltas por etapas (Tour de Kyushu): el evento
-- agrupa una categoría por etapa titulada «STAGE <n>». En ese caso el código es
-- solo <evento>, terminado en el año (tdk2026); el captador localiza la
-- categoría de cada etapa. Solo cambia un CHECK: sin objetos nuevos ni GRANT.
ALTER TABLE public.race_uci_links
  DROP CONSTRAINT IF EXISTS chk_race_uci_links_lapclip_code;

ALTER TABLE public.race_uci_links
  ADD CONSTRAINT chk_race_uci_links_lapclip_code
  CHECK (source <> 'lapclip'
    OR "lapclipCode" ~ '^[0-9]{6}_[A-Za-z0-9_-]+/[0-9]{3}(-[0-9]+)?/[1-9][0-9]{0,2}$'
    OR "lapclipCode" ~ '^[A-Za-z][A-Za-z0-9_-]*20[0-9]{2}$');

COMMENT ON COLUMN public.race_uci_links."lapclipCode" IS
  'LAPCLIP: <evento>/<categoría>/<vueltas> en circuito (261004_oita/200/13) o <evento> en una vuelta por etapas (tdk2026).';
