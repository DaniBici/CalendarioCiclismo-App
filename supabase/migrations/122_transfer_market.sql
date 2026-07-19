-- ═══════════════════════════════════════════════════════════════════
--  122 — MERCADO DE FICHAJES (temporada 2027)
--
--  Pantalla "Fichajes" en web + apps 4.0: feed cronológico inverso de
--  CONFIRMACIONES (fichajes + renovaciones) y detalle por equipo con
--  continúan / llegan / se marchan, distinguiendo CONFIRMADO de RUMOR.
--
--  Piezas:
--  1. rider_transfers — un movimiento de mercado por fila.
--     Convención por type:
--       'transfer'   → fromTeam* = equipo que deja, toTeam* = equipo al que va.
--       'renewal'    → toTeamId  = equipo con el que renueva (fromTeam* NULL).
--       'retirement' → fromTeam* = equipo que deja (toTeam* NULL).
--     fromTeamName/toTeamName = texto libre de respaldo para equipos fuera
--     del catálogo (júniors, conjuntos amateurs, destinos sin catalogar).
--  2. riders_men/women.contractUntil — año de fin de contrato de la ficha
--     (lo muestra la sección "continúan"; NULL = desconocido).
--  3. team_seasons.badgeVisible — la chapa de una temporada puede ocultarse
--     (los equipos no anuncian colores 2027 hasta dentro de meses; solo se
--     muestra donde Dani lo active). Las filas 2026 quedan visibles (true).
--  4. Siembra de team_seasons 2027 para las 4 divisiones (WT/WWT/PT/PRW)
--     copiando la identidad 2026, con la chapa OCULTA por defecto. La
--     pantalla de fichajes lista equipos desde team_seasons[2027] → los
--     renombres/promociones 2027 se editan ahí sin tocar `teams` (cuyo
--     trigger sync_team_to_season pisa siempre el año en curso).
--  5. today_highlights admite targetType 'transfers' (destino fijo, sin
--     carrera — calco de 'championships' pero visible también en web).
--
--  NOTA: recompute_current_team() solo mira afiliaciones del año natural
--  en curso → nada de esto toca currentTeamId ni la temporada 2026. La
--  materialización de plantillas 2027 (rider_team_affiliations year=2027
--  desde los confirmados) es una fase posterior, al cierre del mercado.
-- ═══════════════════════════════════════════════════════════════════

-- ─── 1. rider_transfers ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS rider_transfers (
  id             TEXT PRIMARY KEY,
  season         INTEGER NOT NULL CHECK (season >= 2026),
  "riderId"      TEXT NOT NULL,
  "riderGender"  TEXT NOT NULL CHECK ("riderGender" IN ('male','female')),
  "fromTeamId"   TEXT REFERENCES teams(id) ON DELETE CASCADE,
  "fromTeamName" TEXT,
  "toTeamId"     TEXT REFERENCES teams(id) ON DELETE CASCADE,
  "toTeamName"   TEXT,
  type           TEXT NOT NULL CHECK (type IN ('transfer','renewal','retirement')),
  status         TEXT NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed','rumor')),
  -- Hasta qué año abarca el contrato anunciado (NULL = no comunicado).
  "contractUntil" SMALLINT CHECK ("contractUntil" IS NULL OR "contractUntil" >= 2026),
  -- Fecha del anuncio (ordena el feed; EDITABLE: hay anuncios previos al
  -- 1 de agosto en que abre oficialmente el mercado).
  "announcedAt"  DATE NOT NULL DEFAULT CURRENT_DATE,
  "createdAt"    TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt"    TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Coherencia mínima por tipo (ver convención arriba).
  CONSTRAINT rider_transfers_target_check CHECK (
    (type = 'transfer'   AND ("toTeamId" IS NOT NULL OR "toTeamName" IS NOT NULL)) OR
    (type = 'renewal'    AND "toTeamId" IS NOT NULL) OR
    (type = 'retirement' AND ("fromTeamId" IS NOT NULL OR "fromTeamName" IS NOT NULL))
  )
);

CREATE INDEX IF NOT EXISTS idx_transfers_season_status_date
  ON rider_transfers (season, status, "announcedAt" DESC);
CREATE INDEX IF NOT EXISTS idx_transfers_from_team
  ON rider_transfers ("fromTeamId", season);
CREATE INDEX IF NOT EXISTS idx_transfers_to_team
  ON rider_transfers ("toTeamId", season);
CREATE INDEX IF NOT EXISTS idx_transfers_rider
  ON rider_transfers ("riderId", season);

-- RLS: patrón post-096 — una sola política de SELECT pública + escritura
-- acotada por comando con (select auth.uid()) (initplan).
ALTER TABLE rider_transfers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS rider_transfers_select_public ON rider_transfers;
CREATE POLICY rider_transfers_select_public
  ON rider_transfers FOR SELECT USING (true);

DROP POLICY IF EXISTS rider_transfers_write_ins ON rider_transfers;
CREATE POLICY rider_transfers_write_ins
  ON rider_transfers FOR INSERT TO authenticated
  WITH CHECK ((select auth.uid()) IS NOT NULL);

DROP POLICY IF EXISTS rider_transfers_write_upd ON rider_transfers;
CREATE POLICY rider_transfers_write_upd
  ON rider_transfers FOR UPDATE TO authenticated
  USING ((select auth.uid()) IS NOT NULL)
  WITH CHECK ((select auth.uid()) IS NOT NULL);

DROP POLICY IF EXISTS rider_transfers_write_del ON rider_transfers;
CREATE POLICY rider_transfers_write_del
  ON rider_transfers FOR DELETE TO authenticated
  USING ((select auth.uid()) IS NOT NULL);

-- ─── 2. Fin de contrato en la ficha del corredor ─────────────────
ALTER TABLE riders_men   ADD COLUMN IF NOT EXISTS "contractUntil" SMALLINT;
ALTER TABLE riders_women ADD COLUMN IF NOT EXISTS "contractUntil" SMALLINT;

-- ─── 3. Chapa ocultable por temporada ────────────────────────────
-- Default true → las filas existentes (2026) y las que siga upsertando el
-- trigger sync_team_to_season quedan visibles sin tocarlo.
ALTER TABLE team_seasons ADD COLUMN IF NOT EXISTS "badgeVisible" BOOLEAN NOT NULL DEFAULT true;

-- ─── 4. Siembra team_seasons 2027 (4 divisiones, chapa oculta) ───
INSERT INTO team_seasons (
  id, "teamId", year, name, "nameAliases", category, gender,
  "headerBg", "headerText", "badgeTorsoCenter", "badgeTorsoSides",
  "badgeInnerCircle", "badgeShorts", translations, "badgeVisible",
  "createdAt", "updatedAt"
)
SELECT
  t.id || '_2027', t.id, 2027, t.name, t."nameAliases", t.category, t.gender,
  t."headerBg", t."headerText", t."badgeTorsoCenter", t."badgeTorsoSides",
  t."badgeInnerCircle", t."badgeShorts", '{}'::jsonb, false,
  now(), now()
FROM teams t
WHERE t."specialEdition" = false
  AND t.category IN ('WT','WWT','PT','PRW')
ON CONFLICT ("teamId", year) DO NOTHING;

-- ─── 5. Cintillo: targetType 'transfers' ─────────────────────────
-- Ojo nombres: el CHECK vigente es el lowercase (el camelCase duplicado se
-- dropeó en la 069).
ALTER TABLE today_highlights DROP CONSTRAINT IF EXISTS today_highlights_targettype_check;
ALTER TABLE today_highlights ADD CONSTRAINT today_highlights_targettype_check
  CHECK ("targetType" IN ('raceDay','startlist','startOrder','race','custom','championships','transfers'));

ALTER TABLE today_highlights DROP CONSTRAINT IF EXISTS today_highlights_target_check;
ALTER TABLE today_highlights ADD CONSTRAINT today_highlights_target_check
  CHECK (
    (("targetType" IN ('startlist','race')) AND "raceId" IS NOT NULL) OR
    (("targetType" IN ('raceDay','startOrder')) AND "raceDayId" IS NOT NULL) OR
    ("targetType" = 'custom' AND "customUrl" IS NOT NULL) OR
    ("targetType" = 'championships') OR
    ("targetType" = 'transfers')
  );
