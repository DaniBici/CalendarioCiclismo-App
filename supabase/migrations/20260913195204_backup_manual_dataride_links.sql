-- Respaldo de enlaces sintéticos que se presentaban como DataRide y sus resultados.
CREATE TABLE private.repair_manual_dataride_links_20260913_backup (
  race_id text PRIMARY KEY,
  backed_up_at timestamptz NOT NULL DEFAULT now(),
  snapshot jsonb NOT NULL
);
REVOKE ALL ON private.repair_manual_dataride_links_20260913_backup FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON private.repair_manual_dataride_links_20260913_backup TO service_role;
