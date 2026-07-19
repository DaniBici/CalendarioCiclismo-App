-- ═══════════════════════════════════════════════════════════════════
--  Fase 6 (resultados-web): sembrar startlist_teams + startlist_riders de
--  una carrera SIN inscritos a partir del propio volcado de resultados UCI.
--
--  POR QUÉ. Tras volcar resultados (081/082/083), las carreras sin startlist
--  muestran el corredor por riderDisplay crudo ("MESSEL Kevin Andre Sandli"),
--  sin equipo ni bandera, porque la web (resultados.js, inscritos.js) lee la
--  startlist curada: startlist_riders_resolved (dorsal→globalRiderId→nombre
--  bonito) + startlist_teams (chapa + enlace /equipo/). La RPC 083 ya creó las
--  fichas y enlazó globalRiderId sobre race_uci_results, así que tenemos
--  dorsal→globalRiderId. Sembrando la startlist con eso, la web pinta sola el
--  nombre Title Case de la ficha + bandera + equipo, SIN tocar el front.
--
--  EQUIPOS (decisión de producto, 2026-06-09): casar el teamName de la UCI
--  contra teams por nombre+aliases plegados (misma lógica que findMatchingTeam
--  de shared.js, portada a SQL aquí). Si CASA → startlist_teams.teamId = el
--  canónico (chapa + enlace). Si NO casa → startlist_teams con teamId NULL y el
--  teamName CRUDO de la UCI: la web lo muestra tal cual, sin chapa. **NO se
--  crea ningún equipo en `teams`** (evita duplicar el catálogo curado desde
--  nombres ruidosos de la UCI).
--
--  RENDIMIENTO. El match exacto es O(1) por igualdad sobre teams.foldedNames
--  (array de name+aliases plegados, índice GIN) — NO re-pliega los ~320 teams
--  por cada equipo de cada carrera. El fallback de contención solo corre cuando
--  el exacto falla.
--
--  ENTRADA p_rows: una fila por corredor (deduplicada por bib desde la GC):
--    [{ bib, countryCode, teamName }]
--  El globalRiderId NO viene en p_rows: se LEE de race_uci_results (lo que la 083
--  ya resolvió) por bib → 1 sola fuente de verdad. Llamar SIEMPRE tras la 083.
--
--  IDEMPOTENTE: borra y resiembra startlist_teams/riders de la carrera.
--  Sigue a la 083. La siguiente migración es la 085.
-- ═══════════════════════════════════════════════════════════════════

-- ─── fold_team_name — espejo SQL de normalizeTeamName (shared.js) ───
--  lower → multi-char (ß/æ/œ/ligaduras) → translate de diacríticos → [^a-z0-9]
--  a espacio → quitar stopwords (TEAM_STOPWORDS, EXACTAS) → join preservando
--  orden. IMMUTABLE. La cadena de translate es IDÉNTICA a fold_name (075).
CREATE OR REPLACE FUNCTION public.fold_team_name(p_text text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = ''
AS $$
  SELECT NULLIF(string_agg(tok, ' ' ORDER BY ord), '')
  FROM (
    SELECT tok, ord
    FROM unnest(string_to_array(
      regexp_replace(
        translate(
          replace(replace(replace(replace(replace(replace(
            lower(coalesce(p_text,'')),
            'ß','ss'),'æ','ae'),'œ','oe'),'ﬀ','ff'),'ﬁ','fi'),'ﬂ','fl'),
          'áàâåäãąạćčçďđéèêěëęğíîïłńňñņóòôöőøộřśšşúùûüýžż',
          'aaaaaaaacccddeeeeeegiiilnnnnooooooorsssuuuuyzz'),
        '[^a-z0-9]+', ' ', 'g'
      ), ' '
    )) WITH ORDINALITY AS u(tok, ord)
    WHERE tok <> ''
      AND tok NOT IN (
        'pro','procycling','cycling','team','teams','squad','uci','worldteam',
        'wt','women','womens','feminin','femenino','feminine',
        'continental','development','presented','by','the','de','la','el','of','and'
      )
  ) s
$$;
COMMENT ON FUNCTION public.fold_team_name(text) IS
  'Espejo SQL de normalizeTeamName (shared.js): pliega un nombre de equipo a tokens sin acentos ni stopwords (TEAM_STOPWORDS), preservando orden. Para casar teamName UCI ↔ teams. IMMUTABLE.';

-- ─── teams.foldedNames — array (name + aliases) plegado, indexado GIN ───
--  Materializa el plegado para que el match sea un lookup por igualdad (= ANY)
--  con índice, no un scan que re-pliega. Lo mantiene un trigger en INSERT/UPDATE
--  de name/nameAliases. Backfill al final.
ALTER TABLE public.teams ADD COLUMN IF NOT EXISTS "foldedNames" text[];

CREATE OR REPLACE FUNCTION public.trg_set_team_folded_names()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  SELECT array_agg(DISTINCT f) INTO NEW."foldedNames"
  FROM (
    SELECT public.fold_team_name(nm) AS f
    FROM unnest(string_to_array(NEW.name || E'\n' || COALESCE(NEW."nameAliases",''), E'\n')) AS nm
  ) s
  WHERE f IS NOT NULL AND f <> '';
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS set_team_folded_names ON public.teams;
CREATE TRIGGER set_team_folded_names
  BEFORE INSERT OR UPDATE OF name, "nameAliases" ON public.teams
  FOR EACH ROW EXECUTE FUNCTION public.trg_set_team_folded_names();

CREATE INDEX IF NOT EXISTS idx_teams_folded_names ON public.teams USING GIN ("foldedNames");

-- Backfill de las filas existentes. El UPDATE toca SOLO foldedNames:
--   · set_team_slug es UPDATE OF name → NO se dispara (no tocamos name) → slugs intactos.
--   · sync_team_to_season_trg es AFTER UPDATE → se dispara, pero su upsert a
--     team_seasons es idempotente (mismos datos → solo refresca updatedAt) → inofensivo.
UPDATE public.teams t SET "foldedNames" = sub.arr
FROM (
  SELECT t2.id,
         array_agg(DISTINCT f) FILTER (WHERE f IS NOT NULL AND f <> '') AS arr
  FROM public.teams t2,
       LATERAL unnest(string_to_array(t2.name || E'\n' || COALESCE(t2."nameAliases",''), E'\n')) AS nm
  CROSS JOIN LATERAL (SELECT public.fold_team_name(nm)) AS x(f)
  GROUP BY t2.id
) sub
WHERE t.id = sub.id;

-- ─── RPC resolve_uci_startlist ─────────────────────────────────────
--  Devuelve (teams_seeded, riders_seeded, teams_matched, teams_unmatched).
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

    -- Match EXACTO por igualdad sobre el array indexado (name + aliases plegados).
    SELECT t.id INTO v_team_id
    FROM public.teams t
    WHERE NOT t."specialEdition" AND v_fold = ANY(t."foldedNames")
    LIMIT 1;

    -- Fallback de contención (≥4) solo si el exacto falló.
    IF v_team_id IS NULL AND length(v_fold) >= 4 THEN
      SELECT t.id INTO v_team_id
      FROM public.teams t, unnest(t."foldedNames") AS fn
      WHERE NOT t."specialEdition"
        AND length(fn) >= 4
        AND (fn LIKE '%'||v_fold||'%' OR v_fold LIKE '%'||fn||'%')
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
    -- carrera. La web lo OCULTA (pendiente de programar). Así teamId (NOT NULL) en
    -- startlist_riders siempre apunta a algo y ningún corredor se cae de la startlist.
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
  'Fase 6: siembra startlist_teams + startlist_riders de una carrera desde el volcado UCI (dorsal→globalRiderId de la 083 + país + teamName). Casa equipos contra teams.foldedNames (sin crear); los no casados quedan con teamId NULL y nombre crudo. La web (startlist_riders_resolved) pinta nombre bonito + bandera + equipo. Idempotente.';

REVOKE ALL ON FUNCTION public.fold_team_name(text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.fold_team_name(text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.resolve_uci_startlist(text, text, jsonb) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.resolve_uci_startlist(text, text, jsonb) TO authenticated, service_role;