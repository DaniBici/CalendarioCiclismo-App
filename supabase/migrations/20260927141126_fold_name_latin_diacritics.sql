-- fold_name plegaba solo una lista cerrada de letras latinas con diacrítico: ů, ū, ė, į, ų,
-- ű, ā, ē, ī, ļ, ķ, ģ, ŗ, ș, ț, ð, þ, ı y el resto pasaban a separador, truncaban nombres
-- (fold_name('Tvarůžková') = 'tvar zkova') y generaban identityKey e IDs de ficha rotos
-- (tvar-zkova-tereza) que no casan con fuentes ASCII.
--
-- Nueva definición: minúsculas, ligaduras, descomposición canónica (NFD), eliminación de
-- marcas combinantes y tabla explícita para las letras sin descomposición (đ ł ø ı ħ ŧ ŀ ð
-- ŋ ĸ ƒ, þ, ĳ). Sobre ASCII y sobre las letras que ya plegaba el resultado es idéntico.
-- fold_team_name reutiliza fold_name para no duplicar la tabla.
--
-- Valores persistidos derivados (no hay índices de expresión ni columnas generadas):
-- riders_*."identityKey" (índice único), teams."foldedNames", team_name_aliases."foldedName"
-- y team_link_decisions."foldedName". Se recalculan solo si cambian por esta corrección y no
-- chocan con otra fila; un choque indica un duplicado pendiente de fusión y conserva la clave.

-- 1. Claves de identidad con la definición anterior (solo nombres con caracteres no ASCII).
CREATE TEMP TABLE _fold_identity ON COMMIT DROP AS
SELECT 'riders_men'::text AS tbl, id, "identityKey" AS cur, "firstName" AS f, "lastName" AS l,
       public.compute_identity_key("firstName", "lastName") AS old_base,
       extract(year FROM "birthDate")::text AS yr
FROM public.riders_men
WHERE coalesce("firstName", '') || coalesce("lastName", '') ~ '[^\x01-\x7f]'
UNION ALL
SELECT 'riders_women', id, "identityKey", "firstName", "lastName",
       public.compute_identity_key("firstName", "lastName"),
       extract(year FROM "birthDate")::text
FROM public.riders_women
WHERE coalesce("firstName", '') || coalesce("lastName", '') ~ '[^\x01-\x7f]';

-- 2. Plegado.
CREATE OR REPLACE FUNCTION public.fold_name(p_text text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
 SET search_path TO ''
AS $function$
  SELECT regexp_replace(regexp_replace(regexp_replace(
    translate(
      regexp_replace(
        normalize(
          replace(replace(replace(replace(replace(replace(replace(replace(
            lower(coalesce(p_text, '')),
            'ß','ss'),'æ','ae'),'œ','oe'),'ﬀ','ff'),'ﬁ','fi'),'ﬂ','fl'),'þ','th'),'ĳ','ij'),
          NFD),
        '[̀-ͯ᪰-᫿᷀-᷿⃐-⃿︠-︯]', '', 'g'),
      'đłøıħŧŀðŋĸƒ',
      'dloihtldnkf'),
    '[^a-z0-9]+',' ','g'),'\s+',' ','g'),'(^ | $)','','g')
$function$;

CREATE OR REPLACE FUNCTION public.fold_team_name(p_text text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
 SET search_path TO ''
AS $function$
  SELECT NULLIF(string_agg(tok, ' ' ORDER BY ord), '')
  FROM (
    SELECT tok, ord
    FROM unnest(string_to_array(public.fold_name(p_text), ' ')) WITH ORDINALITY AS u(tok, ord)
    WHERE tok <> ''
      AND tok NOT IN (
        'pro','procycling','cycling','team','teams','squad','uci','worldteam',
        'wt','women','womens','feminin','femenino','feminine',
        'continental','development','presented','by','the','de','la','el','of','and'
      )
  ) s
$function$;

COMMENT ON FUNCTION public.fold_name(text) IS
  'Plegado canónico de nombres: minúsculas, ligaduras, NFD sin marcas combinantes, letras latinas sin descomposición a ASCII y separadores normalizados. Equivalente JS: js/name-fold.js.';

REVOKE ALL ON FUNCTION public.fold_name(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fold_name(text)
  TO anon, authenticated, service_role, cc_results_worker, cc_uci_catalog_owner;
REVOKE ALL ON FUNCTION public.fold_team_name(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fold_team_name(text)
  TO authenticated, service_role, cc_results_worker;

-- 3. identityKey: sustituye la base anterior por la nueva y conserva el sufijo de año.
CREATE TEMP TABLE _fold_identity_new ON COMMIT DROP AS
SELECT tbl, id,
       CASE WHEN cur = old_base THEN new_base
            WHEN cur = old_base || '-' || yr THEN new_base || '-' || yr END AS new_key
FROM (SELECT *, public.compute_identity_key(f, l) AS new_base FROM _fold_identity) s
WHERE old_base IS DISTINCT FROM new_base;

DELETE FROM _fold_identity_new n
WHERE n.new_key IS NULL
   OR EXISTS (SELECT 1 FROM _fold_identity_new o
              WHERE o.tbl = n.tbl AND o.new_key = n.new_key AND o.id <> n.id);

UPDATE public.riders_men r SET "identityKey" = n.new_key
FROM _fold_identity_new n
WHERE n.tbl = 'riders_men' AND r.id = n.id
  AND NOT EXISTS (SELECT 1 FROM public.riders_men o WHERE o."identityKey" = n.new_key AND o.id <> r.id);

UPDATE public.riders_women r SET "identityKey" = n.new_key
FROM _fold_identity_new n
WHERE n.tbl = 'riders_women' AND r.id = n.id
  AND NOT EXISTS (SELECT 1 FROM public.riders_women o WHERE o."identityKey" = n.new_key AND o.id <> r.id);

-- 4. Nombres plegados de equipos. app.historical_catalog evita que sync_team_to_season
-- reescriba team_seasons por esta actualización técnica.
SELECT set_config('app.historical_catalog', 'on', true);

UPDATE public.teams t SET "foldedNames" = s.folded
FROM (
  SELECT id, (
    SELECT array_agg(DISTINCT f)
    FROM (SELECT public.fold_team_name(nm) AS f
          FROM unnest(string_to_array(name || E'\n' || coalesce("nameAliases", ''), E'\n')) AS nm) x
    WHERE f IS NOT NULL AND f <> ''
  ) AS folded
  FROM public.teams
  WHERE name || coalesce("nameAliases", '') ~ '[^\x01-\x7f]'
) s
WHERE t.id = s.id AND t."foldedNames" IS DISTINCT FROM s.folded;

SELECT set_config('app.historical_catalog', '', true);

UPDATE public.team_name_aliases a SET "foldedName" = public.fold_team_name(a.alias)
WHERE a.alias ~ '[^\x01-\x7f]'
  AND a."foldedName" IS DISTINCT FROM public.fold_team_name(a.alias)
  AND NOT EXISTS (SELECT 1 FROM public.team_name_aliases o
                  WHERE o."teamId" = a."teamId" AND o.year IS NOT DISTINCT FROM a.year
                    AND o."foldedName" = public.fold_team_name(a.alias) AND o.id <> a.id);

UPDATE public.team_link_decisions d SET "foldedName" = public.fold_team_name(d."rawName")
WHERE d."rawName" ~ '[^\x01-\x7f]'
  AND d."foldedName" IS DISTINCT FROM public.fold_team_name(d."rawName");
