-- ═══════════════════════════════════════════════════════════════════
--  123 — MERCADO DE FICHAJES: dudas + fecha ocultable
--
--  Tres supuestos que la 122 no cubría:
--
--  1. rider_transfers.dateVisible — la carga inicial del mercado mete de
--     golpe movimientos ya anunciados hace semanas. Con la fecha oculta el
--     movimiento NO sale en el feed de últimos (que solo debe contar lo que
--     se anuncia a partir de ahora) pero SÍ cuenta en la vista de equipo:
--     puebla continúan/llegan/se marchan igual que cualquier otro.
--     announcedAt sigue siendo NOT NULL (ordena y agrupa); esto es un flag
--     de publicación en el feed, no una fecha ausente.
--
--  2. status 'doubt' — cuarta situación de un corredor: ni continúa, ni sale,
--     ni entra; no se sabe si renovará con su equipo de 2027.
--     SOLO válido con type='renewal': la duda es siempre sobre una
--     RENOVACIÓN (¿sigue o no sigue?). Una duda sobre ir a OTRO equipo ya se
--     modela como type='transfer' + status='rumor' — de ahí el CHECK
--     compuesto, que impide 'transfer'/'retirement' en duda.
--     El corredor sale de "continúan" y pasa a su sección "En duda".
--     NO sincroniza riders_*.contractUntil: una duda no es un hecho y no
--     puede pisar el contrato conocido de la ficha (igual que un rumor).
--
--  3. team_seasons.continuityDoubt — el equipo mismo puede estar en duda
--     (ej.: Kern Pharma sin sponsor para 2027). Distinto de la AUSENCIA de
--     fila 2027, que sigue significando "no continúa" (señal dura, 122).
--     Esto es el estado intermedio: sigue listado en su división, con chip
--     y aviso en su vista, mientras no se despeje.
-- ═══════════════════════════════════════════════════════════════════

-- ─── 1. Fecha ocultable en el feed ───────────────────────────────
-- Default true → los movimientos ya registrados siguen saliendo en el feed.
ALTER TABLE rider_transfers
  ADD COLUMN IF NOT EXISTS "dateVisible" BOOLEAN NOT NULL DEFAULT true;

-- El feed pide season + status + dateVisible ordenado por announcedAt.
-- Índice parcial: solo indexa lo que el feed puede llegar a mostrar.
CREATE INDEX IF NOT EXISTS idx_transfers_feed
  ON rider_transfers (season, "announcedAt" DESC)
  WHERE status = 'confirmed' AND "dateVisible" = true;

-- ─── 2. status 'doubt' (solo en renovaciones) ────────────────────
ALTER TABLE rider_transfers DROP CONSTRAINT IF EXISTS rider_transfers_status_check;
ALTER TABLE rider_transfers ADD CONSTRAINT rider_transfers_status_check
  CHECK (status IN ('confirmed','rumor','doubt'));

-- La duda es siempre sobre una renovación. Un 'transfer'/'retirement' en
-- duda sería ambiguo (¿duda de que salga? ¿de a dónde?) → se modela como
-- rumor. Este CHECK lo hace imposible de introducir por error.
ALTER TABLE rider_transfers DROP CONSTRAINT IF EXISTS rider_transfers_doubt_check;
ALTER TABLE rider_transfers ADD CONSTRAINT rider_transfers_doubt_check
  CHECK (status <> 'doubt' OR type = 'renewal');

-- ─── 3. Continuidad del equipo en duda ───────────────────────────
-- Default false → los 55 equipos 2027 ya sembrados nacen sin duda.
ALTER TABLE team_seasons
  ADD COLUMN IF NOT EXISTS "continuityDoubt" BOOLEAN NOT NULL DEFAULT false;
