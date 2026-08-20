-- ═══════════════════════════════════════════════════════════════════
--  DNI DE CORREDOR — riders_*.identityKey + índice único + trigger
--
--  El `id` (slug) de un corredor es opaco y, hasta ahora, era la única
--  forma de "igualdad" entre fichas. Eso permitía que la misma persona
--  entrara dos veces con slugs distintos (orden de apellidos, diacrítico
--  plegado de forma divergente). Este es el DNI estable: una clave
--  derivada SOLO del nombre (atemporal, sin año ni país) que identifica
--  a la persona y, con un índice UNIQUE, impide duplicados nuevos.
--
--  identityKey = token-set ORDENADO del nombre plegado:
--    fold(firstName + ' ' + lastName) -> split por no-alfanumérico
--    -> minúsculas -> dedup -> orden alfabético -> join('-')
--  Así "Marcus Sander Hansen" y "Hansen Marcus Sander" => misma clave
--  (hansen-marcus-sander). El orden de los tokens deja de importar.
--
--  fold canónica (mapa EXPLÍCITO, no unaccent): la función debe ser
--  IMMUTABLE para poder backfillear de forma determinista y sostener un
--  índice. En esta instalación extensions.unaccent() es STABLE (no
--  IMMUTABLE), así que el plegado se hace con translate()/replace()
--  explícito. Cubre el inventario real de diacríticos del catálogo
--  (latinos 1:1 + ß/æ/œ/ligaduras multi-char). Coincide con unaccent
--  para ø→o, ß→ss, æ→ae (verificado) y con la fold del cliente (plan).
--  Caracteres no plegables (p.ej. CJK de los 4 corredores taiwaneses)
--  se eliminan; su parte latina del nombre conserva el token-set.
--
--  HOMÓNIMOS: dos personas distintas con idéntico nombre (verificado:
--  5 pares masculinos, p.ej. dos "Matthew Walls" 1998/2007) comparten
--  el token-set. Para que el índice UNIQUE siga siendo total, al más
--  ANTIGUO se le deja la clave base y al resto se le añade el año de
--  nacimiento como sufijo (matthew-walls vs matthew-walls-1998). El año
--  NO forma parte del cómputo normal: es solo el desempate de homónimos.
--
--  Orden estricto y re-ejecutable: función -> columna -> backfill ->
--  desempate de homónimos -> compuerta (aborta si queda colisión) ->
--  índice UNIQUE parcial -> trigger que mantiene la clave en altas.
--
--  Rollback: DROP TRIGGER + DROP FUNCTION (trigger y compute) +
--  DROP INDEX + DROP COLUMN en ambas tablas.
-- ═══════════════════════════════════════════════════════════════════

-- ─── 1. fold canónica + compute_identity_key (IMMUTABLE) ──────────
-- Plegado de diacríticos a ASCII con mapa explícito. IMMUTABLE: solo
-- usa lower/translate/replace/regexp (todas inmutables).
CREATE OR REPLACE FUNCTION fold_name(p_text text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = ''
AS $$
  SELECT regexp_replace(
    regexp_replace(
      -- 4) cualquier no [a-z0-9] (incl. CJK, combinantes, apóstrofos) -> espacio
      regexp_replace(
        -- 3) translate de diacríticos latinos de 1 carácter -> ASCII
        translate(
          -- 2) multi-carácter ANTES del translate
          replace(replace(replace(replace(replace(replace(
            lower(coalesce(p_text, '')),
            'ß', 'ss'), 'æ', 'ae'), 'œ', 'oe'),
            'ﬀ', 'ff'), 'ﬁ', 'fi'), 'ﬂ', 'fl'),
          -- origen (acentuadas, 46 chars):
          'áàâåäãąạćčçďđéèêěëęğíîïłńňñņóòôöőøộřśšşúùûüýžż',
          -- destino (ASCII, 46 chars, 1:1 con el origen):
          'aaaaaaaacccddeeeeeegiiilnnnnooooooorsssuuuuyzz'
        ),
        '[^a-z0-9]+', ' ', 'g'
      ),
      -- 1) colapsar espacios múltiples
      '\s+', ' ', 'g'
    ),
    -- 0) recortar espacio inicial/final
    '(^ | $)', '', 'g'
  )
$$;

COMMENT ON FUNCTION fold_name(text) IS
  'Plega un texto a ASCII en minúsculas (diacríticos latinos + ß/æ/œ), separadores normalizados a espacio. IMMUTABLE: comparte la fold canónica del cliente (no usa unaccent, que es STABLE).';

-- identityKey = token-set ordenado, dedup, sin vacíos del nombre plegado.
CREATE OR REPLACE FUNCTION compute_identity_key(p_first text, p_last text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = ''
AS $$
  SELECT NULLIF(string_agg(tok, '-' ORDER BY tok), '')
  FROM (
    SELECT DISTINCT tok
    FROM unnest(string_to_array(public.fold_name(coalesce(p_first,'') || ' ' || coalesce(p_last,'')), ' ')) AS tok
    WHERE tok <> ''
  ) s
$$;

COMMENT ON FUNCTION compute_identity_key(text, text) IS
  'DNI atemporal del corredor: token-set ordenado de fold_name(first+last). Sin año ni país. El índice UNIQUE parcial lo usa para rechazar duplicados.';

-- ─── 2. Columna identityKey (nullable) ───────────────────────────
ALTER TABLE riders_men   ADD COLUMN IF NOT EXISTS "identityKey" text;
ALTER TABLE riders_women ADD COLUMN IF NOT EXISTS "identityKey" text;

-- ─── 3. Backfill ─────────────────────────────────────────────────
UPDATE riders_men   SET "identityKey" = compute_identity_key("firstName", "lastName");
UPDATE riders_women SET "identityKey" = compute_identity_key("firstName", "lastName");

-- ─── 4. Desempate de homónimos (mismo token-set, persona distinta) ─
-- En cada grupo colisionante con fecha de nacimiento, la ficha MÁS
-- ANTIGUA conserva la clave base; las demás reciben sufijo '-<año>'.
-- (Verificado: 5 grupos masculinos, 0 femeninos; todos con fechas
-- distintas no nulas, así que el orden por birthDate es determinista.)
WITH g AS (
  SELECT id, "identityKey",
    row_number() OVER (PARTITION BY "identityKey" ORDER BY "birthDate" NULLS LAST, id) AS rn,
    extract(year FROM "birthDate")::int AS anio
  FROM riders_men
  WHERE "identityKey" IN (
    SELECT "identityKey" FROM riders_men WHERE "identityKey" IS NOT NULL
    GROUP BY "identityKey" HAVING count(*) > 1
  )
)
UPDATE riders_men r
SET "identityKey" = g."identityKey" || '-' || g.anio
FROM g
WHERE r.id = g.id AND g.rn > 1 AND g.anio IS NOT NULL;

-- Mismo desempate para mujeres (defensivo; hoy 0 colisiones).
WITH g AS (
  SELECT id, "identityKey",
    row_number() OVER (PARTITION BY "identityKey" ORDER BY "birthDate" NULLS LAST, id) AS rn,
    extract(year FROM "birthDate")::int AS anio
  FROM riders_women
  WHERE "identityKey" IN (
    SELECT "identityKey" FROM riders_women WHERE "identityKey" IS NOT NULL
    GROUP BY "identityKey" HAVING count(*) > 1
  )
)
UPDATE riders_women r
SET "identityKey" = g."identityKey" || '-' || g.anio
FROM g
WHERE r.id = g.id AND g.rn > 1 AND g.anio IS NOT NULL;

-- ─── 5. Compuerta dura: abortar si queda CUALQUIER colisión ───────
-- (re-ejecutable: si saltara, se corrige el dato y se vuelve a aplicar
-- antes de llegar al índice).
DO $$
DECLARE
  v_men int;
  v_women int;
BEGIN
  SELECT count(*) INTO v_men FROM (
    SELECT "identityKey" FROM riders_men WHERE "identityKey" IS NOT NULL
    GROUP BY "identityKey" HAVING count(*) > 1
  ) c;
  SELECT count(*) INTO v_women FROM (
    SELECT "identityKey" FROM riders_women WHERE "identityKey" IS NOT NULL
    GROUP BY "identityKey" HAVING count(*) > 1
  ) c;
  IF v_men > 0 OR v_women > 0 THEN
    RAISE EXCEPTION 'identityKey con colisiones: % en riders_men, % en riders_women. Resolver antes de crear el índice.', v_men, v_women;
  END IF;
END $$;

-- ─── 6. Índice UNIQUE parcial (WHERE identityKey IS NOT NULL) ─────
-- Bloqueante (<1s a esta escala), NO CONCURRENTLY (dentro de migración).
CREATE UNIQUE INDEX IF NOT EXISTS uq_riders_men_identity_key
  ON riders_men ("identityKey") WHERE "identityKey" IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_riders_women_identity_key
  ON riders_women ("identityKey") WHERE "identityKey" IS NOT NULL;

-- ─── 7. Trigger: mantener identityKey en altas/cambios de nombre ──
-- Recomputa la clave BASE en cada INSERT/UPDATE de firstName/lastName.
-- Chokepoint único (panel, skill/MCP, script). Un duplicado con tokens
-- invertidos queda con la misma clave -> lo rechaza el índice -> el
-- llamante lo trata como "ya existe, enlazar".
--
-- FRONTERA: el trigger calcula solo la clave base (normalización), NO
-- re-deriva el sufijo de año de homónimos (eso es lógica de resolución,
-- del RPC/panel — Fase 4). Si el INSERT trae explícitamente una clave
-- ya sufijada con el año de SU fecha de nacimiento (homónimo nuevo
-- legítimo), se respeta; en el caso normal se recomputa.
CREATE OR REPLACE FUNCTION trg_set_identity_key()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_base text;
  v_anio text;
BEGIN
  v_base := public.compute_identity_key(NEW."firstName", NEW."lastName");
  v_anio := CASE WHEN NEW."birthDate" IS NOT NULL
                 THEN extract(year FROM NEW."birthDate")::text ELSE NULL END;
  -- Respetar una clave sufijada por el año propio (homónimo declarado).
  IF NEW."identityKey" IS NOT NULL
     AND v_anio IS NOT NULL
     AND NEW."identityKey" = v_base || '-' || v_anio THEN
    RETURN NEW;
  END IF;
  NEW."identityKey" := v_base;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS set_identity_key_men ON riders_men;
CREATE TRIGGER set_identity_key_men
  BEFORE INSERT OR UPDATE OF "firstName", "lastName" ON riders_men
  FOR EACH ROW EXECUTE FUNCTION trg_set_identity_key();

DROP TRIGGER IF EXISTS set_identity_key_women ON riders_women;
CREATE TRIGGER set_identity_key_women
  BEFORE INSERT OR UPDATE OF "firstName", "lastName" ON riders_women
  FOR EACH ROW EXECUTE FUNCTION trg_set_identity_key();
