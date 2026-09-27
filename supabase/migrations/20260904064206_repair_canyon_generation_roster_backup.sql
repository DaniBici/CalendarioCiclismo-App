-- Respaldo privado del traslado de diez afiliaciones Canyon Generation.
CREATE TABLE private.repair_canyon_generation_roster_20260904_backup (
  entity text NOT NULL,
  row_id text NOT NULL,
  row_data jsonb NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (entity,row_id)
);
ALTER TABLE private.repair_canyon_generation_roster_20260904_backup ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.repair_canyon_generation_roster_20260904_backup FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT ON private.repair_canyon_generation_roster_20260904_backup TO service_role;
CREATE POLICY repair_canyon_generation_roster_no_client_access
  ON private.repair_canyon_generation_roster_20260904_backup
  FOR ALL TO anon,authenticated USING (false) WITH CHECK (false);
