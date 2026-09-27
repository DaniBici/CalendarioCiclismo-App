BEGIN;

ALTER TABLE private.broadcast_source_links
  DROP CONSTRAINT broadcast_source_links_source_check;
ALTER TABLE private.broadcast_source_links
  ADD CONSTRAINT broadcast_source_links_source_check
  CHECK (source IN ('hbo_max', 'rtve', 'eitb', 'sporza', 'caracol', 'rtbf', 'rai', 'lequipe'));

ALTER TABLE private.broadcast_source_observations
  DROP CONSTRAINT broadcast_source_observations_source_check;
ALTER TABLE private.broadcast_source_observations
  ADD CONSTRAINT broadcast_source_observations_source_check
  CHECK (source IN ('hbo_max', 'rtve', 'eitb', 'sporza', 'caracol', 'rtbf', 'rai', 'lequipe'));

COMMIT;
