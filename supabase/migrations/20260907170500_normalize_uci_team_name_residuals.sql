-- Completa dos grafías editoriales que conservaban mayúsculas de la fuente UCI.
BEGIN;

INSERT INTO private.normalize_uci_team_names_20260907_backup(entity,row_key,row_data)
SELECT 'team_seasons',s.id,to_jsonb(s)
FROM private.uci_catalog_team_links l
JOIN public.team_seasons s ON s."teamId"=l.team_id AND s.year=l.season
WHERE (l.season,l.profile,l.gender,s.name) IN (
  (2024,'19703','male','CCACHE X PAR KÜP'),
  (2025,'20626','male','REMBE | RAD-NET')
)
ON CONFLICT DO NOTHING;

UPDATE public.team_seasons s SET
  name=CASE
    WHEN l.season=2024 AND l.profile='19703' THEN 'CCACHE x Par Küp'
    WHEN l.season=2025 AND l.profile='20626' THEN 'REMBE | rad-net'
  END,
  "updatedAt"=transaction_timestamp()
FROM private.uci_catalog_team_links l
WHERE s."teamId"=l.team_id AND s.year=l.season
  AND ((l.season,l.profile,l.gender,s.name)=(2024,'19703','male','CCACHE X PAR KÜP')
    OR (l.season,l.profile,l.gender,s.name)=(2025,'20626','male','REMBE | RAD-NET'));

UPDATE public.teams t SET name='CCACHE x Par Küp',"updatedAt"=transaction_timestamp()
FROM private.uci_catalog_team_links l
WHERE l.season=2024 AND l.profile='19703' AND l.gender='male' AND t.id=l.team_id
  AND t.name='CCACHE X PAR KÜP';

UPDATE public.teams t SET name='REMBE | rad-net',"updatedAt"=transaction_timestamp()
FROM private.uci_catalog_team_links l
WHERE l.season=2025 AND l.profile='20626' AND l.gender='male' AND t.id=l.team_id
  AND t.name='REMBE | RAD-NET';

DO $verify$
BEGIN
  IF (SELECT count(*) FROM private.uci_catalog_team_links l
      JOIN public.team_seasons s ON s."teamId"=l.team_id AND s.year=l.season
      WHERE (l.season=2024 AND l.profile='19703' AND l.gender='male' AND s.name='CCACHE x Par Küp')
         OR (l.season=2025 AND l.profile='20626' AND l.gender='male' AND s.name='REMBE | rad-net'))<>2
  THEN RAISE EXCEPTION 'No se aplicaron las grafías residuales'; END IF;
END
$verify$;

COMMIT;
