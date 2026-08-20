-- ═══════════════════════════════════════════════════════════════════
--  095 — resolve_uci_startlist: guard anti-filial + filtro de género
--  en el matching de equipos.
--
--  PROBLEMA (saneo WT↔devo, 2026-06-11): fold_team_name elimina los
--  stopwords 'development'/'team'/'continental'/'women' → el nombre UCI
--  de una filial ("BAHRAIN VICTORIOUS DEVELOPMENT TEAM") pliega EXACTO
--  igual que el senior ("Bahrain Victorious") y el match `= ANY(foldedNames)`
--  con LIMIT 1 elegía arbitrariamente, en la práctica el senior: 100
--  bloques filiales mostraban la identidad WT/WWT/PT en carreras sub-23.
--  Además el match NO filtraba por género: "LIDL - TREK" en carrera
--  femenina enlazaba al equipo MASCULINO (141 filas + 59 selecciones
--  nacionales femeninas enlazadas a NTM o a clubs masculinos).
--
--  FIX (dos guardas en el match exacto Y en el fallback de contención):
--   1. Género: el candidato debe tener gender NULL o = p_gender.
--   2. Filial: si el nombre de entrada parece de filial (development/
--      devo/u23/academy/rookies/gen-z/future racing/generation/espoirs/
--      continental[e]), el candidato NO puede ser un senior de primera
--      división (WT/WWT/PT/PRW) salvo que su propio nombre sea de filial.
--      Si el nombre de entrada NO parece de filial, el candidato no puede
--      ser una filial declarada (evita que el senior caiga en la filial
--      por contención: "TUDOR" ⊄→ "Tudor U23").
--
--  Limitación conocida (sin cambio): cuando senior y filial comparten
--  fold EXACTO y aparecen en la MISMA carrera, el mapa temporal por fold
--  los funde en un solo bloque nombrado por la primera aparición. Ese
--  resultado coincide con la decisión de producto (squad mixto bajo el
--  senior) salvo que el nombre devo llegue primero — caso raro (los
--  dorsales del senior van antes) que se corrige en el panel.
--
--  La reparación de los datos ya sembrados se hizo aparte (tabla
--  saneo_0611_wtdevo_plan: 142 fusiones, 305 re-enlaces, 13 NTW nuevas).
--
--  Sigue a la 094. La siguiente migración es la 096.
-- ═══════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.resolve_uci_startlist(
  p_race_id text,
  p_gender  text,
  p_rows    jsonb
)
RETURNS TABLE (teams_seeded int, riders_seeded int, teams_matched int, teams_unmatched int)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_row        jsonb;
  v_team_name  text;
  v_fold       text;
  v_team_id    text;
  v_st_id      text;
  v_gid        text;
  v_dorsal     int;
  v_sort       int := 0;
  v_seeded_t   int := 0;
  v_seeded_r   int := 0;
  v_matched    int := 0;
  v_unmatched  int := 0;
  v_is_devo    boolean;
  -- nombre de entrada "de filial": marcadores devo + continental(e)/generation
  -- (la UCI nombra así a las filiales conti de los WT/WWT).
  v_devo_in_rx constant text :=
    '(development|développement|\mdevo\M|\mu[ -]?23\M|academy|académie|rookies|\mgen[ -]?z\M|future racing|\mespoirs?\M|continentale?\M|generation)';
  -- entrada NO-filial: bloquear solo entradas de catálogo declaradamente
  -- filiales (sin 'continental': hay CT standalone legítimos con esa palabra).
  v_devo_cat_rx constant text :=
    '(development|\mdevo\M|\mu[ -]?23\M|academy|rookies|\mgen[ -]?z\M|future racing|generation)';
BEGIN
  IF p_gender NOT IN ('male','female') THEN
    RAISE EXCEPTION 'p_gender debe ser male|female, recibido %', p_gender;
  END IF;

  DELETE FROM public.startlist_riders WHERE "raceId" = p_race_id;
  DELETE FROM public.startlist_teams  WHERE "raceId" = p_race_id;

  DROP TABLE IF EXISTS _uci_team_map;
  CREATE TEMP TABLE _uci_team_map (fold text PRIMARY KEY, st_id text, team_id text)
    ON COMMIT DROP;

  -- 1) Equipos únicos → casar contra teams (sin crear) → sembrar startlist_teams.
  FOR v_row IN SELECT * FROM jsonb_array_elements(p_rows)
  LOOP
    v_team_name := NULLIF(btrim(v_row->>'teamName'), '');
    IF v_team_name IS NULL THEN CONTINUE; END IF;
    v_fold := COALESCE(public.fold_team_name(v_team_name), lower(v_team_name));
    CONTINUE WHEN EXISTS (SELECT 1 FROM _uci_team_map m WHERE m.fold = v_fold);

    v_is_devo := lower(v_team_name) ~ v_devo_in_rx;

    -- Match EXACTO por igualdad sobre el array indexado (name + aliases plegados),
    -- con filtro de género (095) y guard anti-filial (095).
    SELECT t.id INTO v_team_id
    FROM public.teams t
    WHERE NOT t."specialEdition"
      AND v_fold = ANY(t."foldedNames")
      AND (t.gender IS NULL OR t.gender = p_gender)
      AND (CASE WHEN v_is_devo
             THEN t.category IS NULL OR t.category NOT IN ('WT','WWT','PT','PRW')
                  OR lower(t.name) ~ v_devo_in_rx
             ELSE NOT (lower(t.name) ~ v_devo_cat_rx) END)
    LIMIT 1;

    -- Fallback de contención (≥4) solo si el exacto falló. Mismas guardas.
    IF v_team_id IS NULL AND length(v_fold) >= 4 THEN
      SELECT t.id INTO v_team_id
      FROM public.teams t, unnest(t."foldedNames") AS fn
      WHERE NOT t."specialEdition"
        AND length(fn) >= 4
        AND (fn LIKE '%'||v_fold||'%' OR v_fold LIKE '%'||fn||'%')
        AND (t.gender IS NULL OR t.gender = p_gender)
        AND (CASE WHEN v_is_devo
               THEN t.category IS NULL OR t.category NOT IN ('WT','WWT','PT','PRW')
                    OR lower(t.name) ~ v_devo_in_rx
               ELSE NOT (lower(t.name) ~ v_devo_cat_rx) END)
      LIMIT 1;
    END IF;

    IF v_team_id IS NOT NULL THEN v_matched := v_matched + 1; ELSE v_unmatched := v_unmatched + 1; END IF;

    v_st_id := 'sluci_' || md5(p_race_id || '|' || v_fold);
    INSERT INTO public.startlist_teams (id, "raceId", "teamName", "sortOrder", "teamId", "isConfirmed")
    VALUES (v_st_id, p_race_id, v_team_name, v_sort, v_team_id, false);
    v_seeded_t := v_seeded_t + 1;
    v_sort := v_sort + 1;
    INSERT INTO _uci_team_map (fold, st_id, team_id) VALUES (v_fold, v_st_id, v_team_id);
  END LOOP;

  -- 2) Corredores → startlist_riders (uno por bib), enlazados a su st_id.
  FOR v_row IN SELECT * FROM jsonb_array_elements(p_rows)
  LOOP
    CONTINUE WHEN (v_row->>'bib') IS NULL OR (v_row->>'bib') !~ '^[0-9]+$';
    v_dorsal := (v_row->>'bib')::int;
    v_team_name := NULLIF(btrim(v_row->>'teamName'), '');
    v_fold := CASE WHEN v_team_name IS NULL THEN NULL
                   ELSE COALESCE(public.fold_team_name(v_team_name), lower(v_team_name)) END;
    v_st_id := NULL;
    IF v_fold IS NOT NULL THEN
      SELECT m.st_id INTO v_st_id FROM _uci_team_map m WHERE m.fold = v_fold;
    END IF;
    -- Sin equipo declarado en la UCI (típicamente DNF que pierden el equipo en la
    -- GC) → equipo ficticio "Individual" (teamId NULL), creado una sola vez por
    -- carrera. La web lo OCULTA. Así teamId (NOT NULL) en startlist_riders
    -- siempre apunta a algo y ningún corredor se cae de la startlist.
    IF v_st_id IS NULL THEN
      SELECT m.st_id INTO v_st_id FROM _uci_team_map m WHERE m.fold = '\x00individual';
      IF v_st_id IS NULL THEN
        v_st_id := 'sluci_' || md5(p_race_id || '|individual');
        INSERT INTO public.startlist_teams (id, "raceId", "teamName", "sortOrder", "teamId", "isConfirmed")
        VALUES (v_st_id, p_race_id, 'Individual', 9999, NULL, false);
        INSERT INTO _uci_team_map (fold, st_id, team_id) VALUES ('\x00individual', v_st_id, NULL);
        v_seeded_t := v_seeded_t + 1;
      END IF;
    END IF;

    -- globalRiderId: lo que la 083 ya resolvió sobre race_uci_results (1 sola
    -- fuente de verdad). Por bib, de cualquier clasificación individual de la carrera.
    SELECT r."globalRiderId" INTO v_gid
    FROM public.race_uci_results r
    JOIN public.race_uci_stages st ON st.id = r."stageRef"
    WHERE r."raceId" = p_race_id AND st."isTeamEvent" = false
      AND r.bib = v_dorsal::text AND r."globalRiderId" IS NOT NULL
    LIMIT 1;

    INSERT INTO public.startlist_riders
      (id, "teamId", "raceId", dorsal, "firstName", "lastName", "countryCode", "globalRiderId")
    VALUES (
      'sruci_' || md5(p_race_id || '|' || v_dorsal::text),
      v_st_id, p_race_id, v_dorsal,
      '', '',   -- snapshot vacío: la vista toma el nombre de la ficha por globalRiderId
      NULLIF(lower(COALESCE(v_row->>'countryCode','')), ''),
      v_gid
    )
    ON CONFLICT (id) DO NOTHING;
    v_seeded_r := v_seeded_r + 1;
  END LOOP;

  -- La startlist sembrada referencia equipos del catálogo (teamId canónico) →
  -- es enriquecida: marcar el flag para que inscritos.js/equipo.js carguen el
  -- nombre bonito + chapa del catálogo (si no, caen al teamName crudo de la UCI).
  UPDATE public.races SET "enrichedStartlist" = true
  WHERE id = p_race_id AND "enrichedStartlist" IS DISTINCT FROM true;

  teams_seeded := v_seeded_t; riders_seeded := v_seeded_r;
  teams_matched := v_matched; teams_unmatched := v_unmatched;
  RETURN NEXT;
END $$;

COMMENT ON FUNCTION public.resolve_uci_startlist(text, text, jsonb) IS
  'Fase 6: siembra startlist_teams + startlist_riders de una carrera desde el volcado UCI (dorsal→globalRiderId de la 083 + país + teamName). Casa equipos contra teams.foldedNames (sin crear) con filtro de género y guard anti-filial (095): un nombre devo-like no enlaza a un senior WT/WWT/PT/PRW y viceversa. Los no casados quedan con teamId NULL y nombre crudo. Idempotente.';

REVOKE ALL ON FUNCTION public.resolve_uci_startlist(text, text, jsonb) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.resolve_uci_startlist(text, text, jsonb) TO authenticated, service_role;
