-- No aplicar fold_team_name a los placeholders: elimina palabras genéricas y
-- convertiría, por ejemplo, el club real "UN Cycling Team" en "un".

CREATE OR REPLACE FUNCTION public.is_startlist_no_team_placeholder(p_name text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = ''
AS $$
  SELECT btrim(regexp_replace(replace(lower(coalesce(p_name, '')), '-', ' '), '\s+', ' ', 'g'))
    = ANY (ARRAY[
      'individual',
      'private member',
      'sin equipo',
      'un',
      'un attached leinster'
    ]::text[]);
$$;

COMMENT ON FUNCTION public.is_startlist_no_team_placeholder(text) IS
  'Identifica únicamente las cinco etiquetas literales de startlist sin equipo; no elimina palabras genéricas del nombre.';
