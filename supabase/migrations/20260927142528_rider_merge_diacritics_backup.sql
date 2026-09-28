-- Respaldo de la fusión de fichas de carretera duplicadas por el plegado anterior de
-- fold_name (Gedraitytė y Sigurðardóttir, 2026-09-27). Solo accesible por el propietario.
CREATE TABLE IF NOT EXISTS private.rider_merge_diacritics_20260927_backup (
  kind text NOT NULL,
  data jsonb NOT NULL,
  "backedUpAt" timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON TABLE private.rider_merge_diacritics_20260927_backup
  FROM PUBLIC, anon, authenticated, service_role;
