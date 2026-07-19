-- ═══════════════════════════════════════════════════════════════════
--  SLUG PÚBLICO DEL EQUIPO — teams.slug
--
--  Para las páginas públicas de equipo (/equipo/<slug>/) hace falta un
--  identificador legible y estable. Hasta ahora la identidad de un equipo
--  era su `id` text feo (team_1776703130449_us300h). Esto añade un slug
--  bonito derivado del nombre, con la MISMA fold canónica que el resto del
--  sistema (fold_name: mapa explícito de diacríticos ø/ł/ß/æ/œ + ligaduras,
--  NO el NFD+strip de JS que los corrompe — ver migración 075/079).
--
--  REGLAS DE SLUG (decididas con Dani 2026-06-09):
--   (1) Las ediciones especiales (specialEdition=true, p.ej. un maillot
--       especial para una carrera) NO reciben slug → slug = NULL. Su página
--       pública redirige al equipo padre (parentTeamId): mismo equipo, otro
--       maillot, no merece página duplicada (SEO + UX).
--   (2) base = fold_name(name) con espacios → guion.
--   (3) Cuando varios equipos NO-special comparten la misma base y uno es
--       FEMENINO (Movistar masc + Movistar fem, Lidl-Trek WT+WWT, Visma…),
--       el femenino recibe sufijo '-femenino'; el masculino/sin-género se
--       queda la base limpia. Convención habitual en webs de ciclismo.
--   (4) Cinturón de seguridad: si tras (3) algún slug sigue repetido, se
--       desempata con sufijo numérico (-2, -3…) por orden de id. Con los
--       datos de 2026 NO se activa (verificado en seco: 0 colisiones).
--
--  Índice UNIQUE PARCIAL (WHERE slug IS NOT NULL): garantiza unicidad de los
--  slugs reales y a la vez permite múltiples NULL (las 7 ediciones especiales).
--
--  AUTO-GENERACIÓN: un trigger BEFORE INSERT/UPDATE rellena el slug cuando se
--  crea o renombra un equipo no-special sin slug explícito, resolviendo
--  colisiones (-femenino / -N). Así el panel no tiene que calcular nada:
--  Dani crea el equipo y la URL se construye sola.
-- ═══════════════════════════════════════════════════════════════════

-- ─── 1. Columna ──────────────────────────────────────────────────
ALTER TABLE teams
  ADD COLUMN IF NOT EXISTS "slug" TEXT;

COMMENT ON COLUMN teams."slug" IS
  'Slug público para /equipo/<slug>/. Derivado de fold_name(name) con guiones; '
  'femenino homónimo → sufijo -femenino. NULL en ediciones especiales '
  '(specialEdition=true): su página redirige al equipo padre. Auto-generado por trigger.';

-- ─── 2. Helper: deriva el slug "base" de un nombre ───────────────
-- fold_name ya deja [a-z0-9] separados por espacios; aquí espacios → guion.
CREATE OR REPLACE FUNCTION public.team_base_slug(p_name text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = ''
AS $$
  SELECT NULLIF(
    regexp_replace(
      regexp_replace(public.fold_name(coalesce(p_name, '')), ' ', '-', 'g'),
      '-{2,}', '-', 'g'
    ),
    ''
  )
$$;

COMMENT ON FUNCTION public.team_base_slug(text) IS
  'Slug base de un equipo: fold_name(name) con espacios→guion. NULL si vacío.';

-- ─── 3. Backfill (lógica validada en seco: 310 slugs, 0 colisiones) ─
WITH base AS (
  SELECT id, gender, "specialEdition",
    public.team_base_slug(name) AS b
  FROM teams
  WHERE "specialEdition" IS NOT TRUE
),
flagged AS (
  SELECT id, gender, b,
    sum(CASE WHEN gender IS DISTINCT FROM 'female' THEN 1 ELSE 0 END)
      OVER (PARTITION BY b) AS nonfem_n
  FROM base
),
step1 AS (
  SELECT id,
    CASE
      WHEN gender = 'female' AND nonfem_n >= 1 THEN b || '-femenino'
      ELSE b
    END AS slug1
  FROM flagged
),
final AS (
  SELECT id, slug1,
    row_number() OVER (PARTITION BY slug1 ORDER BY id) AS rn
  FROM step1
)
UPDATE teams t
SET slug = CASE WHEN f.rn = 1 THEN f.slug1 ELSE f.slug1 || '-' || f.rn END
FROM final f
WHERE t.id = f.id;

-- Las ediciones especiales quedan con slug NULL explícito (ya lo están por defecto).

-- ─── 4. Índice UNIQUE parcial ────────────────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS uq_teams_slug
  ON teams (slug)
  WHERE slug IS NOT NULL;

-- ─── 5. Trigger de auto-generación ───────────────────────────────
-- Rellena slug en altas/renombrados de equipos NO-special que no traigan
-- slug explícito. Resuelve colisiones probando: base, base-femenino (si fem),
-- base-2, base-3… hasta encontrar uno libre (excluyendo la propia fila).
CREATE OR REPLACE FUNCTION public.trg_set_team_slug()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_base   text;
  v_try    text;
  v_n      int := 1;
BEGIN
  -- Ediciones especiales: nunca slug (redirigen al padre).
  IF NEW."specialEdition" IS TRUE THEN
    NEW.slug := NULL;
    RETURN NEW;
  END IF;

  -- Si ya trae slug explícito (y en UPDATE no cambió el nombre), respétalo.
  IF NEW.slug IS NOT NULL AND NEW.slug <> '' THEN
    IF TG_OP = 'UPDATE' AND NEW.slug IS DISTINCT FROM OLD.slug THEN
      RETURN NEW;  -- el panel forzó un slug a mano
    END IF;
    IF TG_OP = 'INSERT' THEN
      RETURN NEW;  -- alta con slug a mano
    END IF;
    -- UPDATE sin tocar slug: solo regenerar si cambió el nombre
    IF TG_OP = 'UPDATE' AND NEW.name IS NOT DISTINCT FROM OLD.name THEN
      RETURN NEW;
    END IF;
  END IF;

  v_base := public.team_base_slug(NEW.name);
  IF v_base IS NULL THEN
    NEW.slug := NULL;  -- nombre vacío → sin slug (caso patológico)
    RETURN NEW;
  END IF;

  -- Candidato base; si es femenino y choca con un no-femenino, prueba -femenino primero.
  v_try := v_base;
  IF NEW.gender = 'female'
     AND EXISTS (SELECT 1 FROM public.teams
                 WHERE slug = v_base AND id <> NEW.id) THEN
    v_try := v_base || '-femenino';
  END IF;

  -- Bucle hasta slug libre.
  WHILE EXISTS (SELECT 1 FROM public.teams WHERE slug = v_try AND id <> NEW.id) LOOP
    v_n := v_n + 1;
    v_try := v_base || '-' || v_n;
  END LOOP;

  NEW.slug := v_try;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS set_team_slug ON teams;
CREATE TRIGGER set_team_slug
  BEFORE INSERT OR UPDATE OF name, gender, "specialEdition", slug ON teams
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_set_team_slug();
