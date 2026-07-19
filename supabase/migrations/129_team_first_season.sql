-- ─────────────────────────────────────────────────────────────────
--  129 · teams.firstSeason — equipos que NACEN en una temporada futura
--
--  Contexto (mercado de fichajes, mig. 122/123). Un equipo "nuevo" del mercado
--  —que no existía en la temporada en curso— se crea desde «+ Equipo 2027» con
--  el editor de equipo estándar → INSERT en `teams`. El FK
--  team_seasons."teamId" NOT NULL REFERENCES teams(id) obliga a esa fila en
--  `teams`: NO se puede tener un team_seasons[2027] "suelto" sin identidad en
--  el catálogo.
--
--  Problema: el trigger sync_team_to_season (mig. 077) estampa una fila
--  team_seasons del AÑO NATURAL EN CURSO (hoy 2026) en cada INSERT/UPDATE de
--  `teams`. Así, un equipo nacido para 2027 ganaba una identidad 2026 que nunca
--  tuvo. Eso rompe la señal "sin fila 2026 = equipo nuevo" que usa el mercado
--  para decidir, mientras la chapa 2027 está OCULTA, si muestra los COLORES
--  ANTIGUOS del equipo (equipo que continúa: los que la gente ya conoce) o NADA
--  (equipo nuevo: no hay kit antiguo que enseñar hasta anunciar el de 2027).
--
--  Fix de raíz: `teams."firstSeason"` = año de la primera temporada del equipo.
--  El trigger NO estampa la temporada del año en curso si firstSeason es
--  ESTRICTAMENTE futura → un equipo nacido en 2027 nunca tiene fila 2026, ni
--  aunque se edite luego su identidad en el editor estándar. NULL = equipo
--  preexistente (comportamiento idéntico al de siempre). Retrocompatible: las
--  55 filas 2027 sembradas (equipos reales de 2026) tienen firstSeason NULL y
--  conservan su fila 2026 real → siguen mostrando sus colores antiguos.
--
--  Los clientes (web/iOS/Android) NO leen `firstSeason`: detectan "equipo
--  nuevo" por la AUSENCIA de fila team_seasons[2026], que este guard garantiza.
-- ─────────────────────────────────────────────────────────────────

ALTER TABLE teams ADD COLUMN IF NOT EXISTS "firstSeason" SMALLINT;

CREATE OR REPLACE FUNCTION public.sync_team_to_season()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_year integer := extract(year from now())::int;
BEGIN
  IF NEW."specialEdition" IS TRUE THEN
    RETURN NEW;  -- los maillots especiales no son la versión canónica del año
  END IF;

  -- Equipo que NACE en una temporada futura (p. ej. un «+ Equipo 2027» creado
  -- en 2026): no pertenece al año en curso, así que no se le estampa su
  -- temporada. Evita la identidad 2026 fantasma. Cuando el año natural alcance
  -- firstSeason, el guard deja de aplicar y el trigger vuelve a sincronizarlo
  -- con normalidad.
  IF NEW."firstSeason" IS NOT NULL AND NEW."firstSeason" > v_year THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.team_seasons (
    id, "teamId", year, name, "nameAliases", category, gender,
    "headerBg", "headerText", "badgeTorsoCenter", "badgeTorsoSides",
    "badgeInnerCircle", "badgeShorts", translations, "createdAt", "updatedAt"
  ) VALUES (
    NEW.id || '_' || v_year, NEW.id, v_year, NEW.name, NEW."nameAliases",
    NEW.category, NEW.gender,
    COALESCE(NEW."headerBg", '#1f2937'), COALESCE(NEW."headerText", '#ffffff'),
    COALESCE(NEW."badgeTorsoCenter", '#ffffff'), COALESCE(NEW."badgeTorsoSides", '#000000'),
    NEW."badgeInnerCircle", COALESCE(NEW."badgeShorts", '#000000'),
    '{}'::jsonb, now(), now()
  )
  ON CONFLICT ("teamId", year) DO UPDATE SET
    name               = EXCLUDED.name,
    "nameAliases"      = EXCLUDED."nameAliases",
    category           = EXCLUDED.category,
    gender             = EXCLUDED.gender,
    "headerBg"         = EXCLUDED."headerBg",
    "headerText"       = EXCLUDED."headerText",
    "badgeTorsoCenter" = EXCLUDED."badgeTorsoCenter",
    "badgeTorsoSides"  = EXCLUDED."badgeTorsoSides",
    "badgeInnerCircle" = EXCLUDED."badgeInnerCircle",
    "badgeShorts"      = EXCLUDED."badgeShorts",
    "updatedAt"        = now();

  RETURN NEW;
END $$;

-- El trigger sync_team_to_season_trg (mig. 077) ya apunta a esta función por
-- nombre: CREATE OR REPLACE conserva el binding, no hay que recrearlo.
