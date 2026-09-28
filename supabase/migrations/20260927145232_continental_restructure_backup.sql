-- Respaldo de la reestructuración de los Campeonatos de Asia, Panamericanos y de Oceanía
-- 2026 (carreras paraguas con pruebas de ambos géneros) en una carrera por prueba y género,
-- y de la corrección de fichas asociada (2026-09-27). Solo accesible por el propietario.
CREATE TABLE IF NOT EXISTS private.continental_restructure_20260927_backup (
  kind text NOT NULL,
  data jsonb NOT NULL,
  "backedUpAt" timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON TABLE private.continental_restructure_20260927_backup
  FROM PUBLIC, anon, authenticated, service_role;
