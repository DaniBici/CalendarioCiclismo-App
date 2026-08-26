-- Amplía la auditoría de emisiones a EITB y Sporza sin concederles por sí
-- misma capacidad de escritura. El modo apply se controla en el servicio VPS.

ALTER TABLE private.broadcast_source_links
  DROP CONSTRAINT broadcast_source_links_source_check;
ALTER TABLE private.broadcast_source_links
  ADD CONSTRAINT broadcast_source_links_source_check
  CHECK (source IN ('hbo_max', 'rtve', 'eitb', 'sporza'));

ALTER TABLE private.broadcast_source_observations
  DROP CONSTRAINT broadcast_source_observations_source_check;
ALTER TABLE private.broadcast_source_observations
  ADD CONSTRAINT broadcast_source_observations_source_check
  CHECK (source IN ('hbo_max', 'rtve', 'eitb', 'sporza'));
