-- Los nombres regionales se equiparan a NTM/NTW, pero conservan ámbito
-- regional para evitar que un alias histórico de teams fuerce ámbito nacional.

UPDATE public.team_selection_aliases tsa
SET "selectionScope" = seed.scope,
    "countryCode" = seed.country_code,
    "selectionCode" = seed.code,
    source = 'catalog_rule',
    verified = true,
    "updatedAt" = now()
FROM (VALUES
  ('es-ct', 'Catalunya', 'regional', 'es'),
  ('es-pv', 'País Vasco', 'regional', 'es'),
  ('es-gal', 'Galicia', 'regional', 'es'),
  ('es-ast', 'Asturias', 'regional', 'es'),
  ('es-and', 'Andalusia', 'regional', 'es'),
  ('euskadi', 'Euskadi', 'regional', 'es'),
  ('catalonia', 'Catalonia', 'regional', 'es'),
  ('bretagne', 'Bretagne', 'regional', 'fr'),
  ('normandie', 'Normandie', 'regional', 'fr'),
  ('flanders', 'Flanders', 'regional', 'be'),
  ('wallonia', 'Wallonia', 'regional', 'be'),
  ('scotland', 'Scotland', 'regional', 'gb'),
  ('wales', 'Wales', 'regional', 'gb'),
  ('england', 'England', 'regional', 'gb'),
  ('lombardia', 'Lombardia', 'regional', 'it'),
  ('toscana', 'Toscana', 'regional', 'it'),
  ('sicilia', 'Sicilia', 'regional', 'it'),
  ('veneto', 'Veneto', 'regional', 'it')
) AS seed(code, name, scope, country_code)
WHERE tsa."foldedName" = public.fold_team_name(seed.name);
