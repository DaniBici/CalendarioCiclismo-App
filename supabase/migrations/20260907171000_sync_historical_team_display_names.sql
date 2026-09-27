-- Sincroniza el nombre visible de matrices históricas con su última temporada normalizada.
BEGIN;

CREATE TEMP TABLE _historical_team_display_names ON COMMIT DROP AS
SELECT t.id,t.name old_name,latest.name new_name
FROM public.teams t
JOIN (SELECT DISTINCT team_id FROM private.uci_catalog_team_links WHERE season BETWEEN 2020 AND 2026) c
  ON c.team_id=t.id
JOIN LATERAL (
  SELECT s.name FROM public.team_seasons s WHERE s."teamId"=t.id ORDER BY s.year DESC LIMIT 1
) latest ON true
WHERE t."historicalCatalogOnly"=true AND t.name=upper(t.name) AND t.name~'[[:alpha:]]'
  AND t.name IS DISTINCT FROM latest.name;

DO $preflight$
BEGIN
  IF (SELECT count(*) FROM _historical_team_display_names)<>15
  THEN RAISE EXCEPTION 'Cambió el conjunto de matrices históricas pendiente de normalización'; END IF;
END
$preflight$;

INSERT INTO private.normalize_uci_team_names_20260907_backup(entity,row_key,row_data)
SELECT 'teams',t.id,to_jsonb(t) FROM public.teams t
JOIN _historical_team_display_names n ON n.id=t.id
ON CONFLICT DO NOTHING;

SELECT set_config('app.historical_catalog','on',true);

UPDATE public.teams t SET name=n.new_name,"updatedAt"=transaction_timestamp()
FROM _historical_team_display_names n WHERE t.id=n.id AND t.name=n.old_name;

DO $verify$
BEGIN
  IF (SELECT count(*) FROM _historical_team_display_names n
      JOIN public.teams t ON t.id=n.id AND t.name=n.new_name)<>15
  THEN RAISE EXCEPTION 'No se sincronizaron las matrices históricas'; END IF;
END
$verify$;

COMMIT;
