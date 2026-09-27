-- Corrige el ámbito de selecciones regionales ya catalogadas. La categoría
-- NTM/NTW y la identidad estable no se modifican.

INSERT INTO private.team_catalog_backfill_20260830_backup
  (operation, entity, row_id, recorded_at, row_data)
SELECT
  'team-catalog-backfill-20260830',
  'teams',
  t.id,
  transaction_timestamp(),
  to_jsonb(t)
FROM public.teams t
WHERE t.category IN ('NTM', 'NTW')
  AND t."specialEdition" IS NOT TRUE
  AND t."selectionScope" IS DISTINCT FROM 'regional'
  AND EXISTS (
    SELECT 1
    FROM public.team_selection_aliases tsa
    WHERE tsa."selectionScope"='regional'
      AND (
        public.fold_team_name(t.name)=tsa."foldedName"
        OR tsa."foldedName" = ANY(t."foldedNames")
        OR EXISTS (
          SELECT 1
          FROM unnest(COALESCE(string_to_array(t."nameAliases", E'\n'), ARRAY[]::text[])) AS a(alias)
          WHERE public.fold_team_name(a.alias)=tsa."foldedName"
        )
      )
  )
ON CONFLICT (operation, entity, row_id) DO NOTHING;

UPDATE public.teams t
SET "selectionScope" = regional."selectionScope",
    "selectionCode" = regional."selectionCode",
    "updatedAt" = now()
FROM (
  SELECT DISTINCT ON (t.id)
    t.id,
    tsa."selectionScope",
    tsa."selectionCode"
  FROM public.teams t
  JOIN public.team_selection_aliases tsa
    ON tsa."selectionScope"='regional'
   AND (
     public.fold_team_name(t.name)=tsa."foldedName"
     OR tsa."foldedName" = ANY(t."foldedNames")
     OR EXISTS (
       SELECT 1
       FROM unnest(COALESCE(string_to_array(t."nameAliases", E'\n'), ARRAY[]::text[])) AS a(alias)
       WHERE public.fold_team_name(a.alias)=tsa."foldedName"
     )
   )
  WHERE t.category IN ('NTM', 'NTW')
    AND t."specialEdition" IS NOT TRUE
  ORDER BY t.id, tsa.id
) regional
WHERE t.id = regional.id;
