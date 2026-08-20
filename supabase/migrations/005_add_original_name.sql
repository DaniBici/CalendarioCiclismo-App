-- Añade campo "nombre original" a las carreras (para SEO)
ALTER TABLE races ADD COLUMN IF NOT EXISTS "originalName" TEXT;
