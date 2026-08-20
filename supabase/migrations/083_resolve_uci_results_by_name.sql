-- ═══════════════════════════════════════════════════════════════════
--  Fase 6 (resultados-web, PLAN-resultados-web.md §3/§7): volcado de
--  resultados de carreras SIN startlist curada.
--
--  CONTEXTO. resolve_uci_results (082) enlaza globalRiderId POR DORSAL vía
--  la startlist (bib → startlist_riders.dorsal → globalRiderId). Funciona
--  cuando la carrera TIENE startlist. Pero 160 de las 276 carreras 2026 ya
--  disputadas NO tienen startlist (continentales pequeñas, 1.2/1.2U) → ahí
--  el dorsal no resuelve nada.
--
--  TESIS (verificada sobre Ringerike GP, comp 77627): la propia UCI publica
--  en cada fila de resultados el corredor COMPLETO — DisplayName ("MESSEL
--  Kevin Andre Sandli"), IsoCode2 ("no") y BirthDate ("2004-07-01"): 100%
--  nombre, 100% nacionalidad, 98.6% fecha de nacimiento. Por tanto, para las
--  carreras sin startlist podemos resolver el corredor DIRECTAMENTE desde la
--  fila de resultado, casando por nombre (identityKey) y CREANDO la ficha que
--  falte con nombre+apellido+nacionalidad+fecha (la política ya establecida
--  para startlists: si falta el corredor, se añade — resolve_riders 078).
--
--  Esta RPC es la fusión de resolve_riders (auto-crear ficha por identityKey)
--  + resolve_uci_results (escribir globalRiderId sobre race_uci_results). A
--  diferencia de 082, NO pasa por la startlist: el nombre/fecha vienen del
--  propio resultado. El cliente (upsert) parte DisplayName → first/last con
--  heurística Unicode-aware (apellido = tokens en MAYÚSCULAS) y pasa las filas
--  ya separadas; el split exacto NO importa para casar porque identityKey es
--  token-set (invariante al orden de los tokens).
--
--  source = 'catalog_gold' (decisión de producto: el dato es oficial UCI).
--  verified = false (no lo ha revisado un humano).
--
--  Sigue a la 082. La siguiente migración es la 084.
-- ═══════════════════════════════════════════════════════════════════

-- ─── RPC resolve_uci_results_by_name ───────────────────────────────
--  Entrada:
--    p_race_id  text  — la carrera (race_uci_results.raceId).
--    p_gender   text  — 'male' | 'female' (elige riders_men/women; viene de races.gender).
--    p_rows     jsonb — [{ bib, firstName, lastName, countryCode, birthDate }]
--                       UNA por corredor (deduplicada por el cliente desde la GC;
--                       birthDate ISO 'YYYY-MM-DD' o null; bib = dorsal del resultado).
--
--  Hace, por cada fila:
--    1) identityKey = compute_identity_key(first,last). Sin tokens → se ignora.
--    2) ¿existe ficha por identityKey exacto? → usar su id.
--    3) si no → CREAR ficha (id = slug apellido-nombre por fold_name, sufijo
--       numérico ante colisión de PK; nationality + birthDate de la fila;
--       source='catalog_gold'; verified=false; identityKey lo pone el trigger).
--       Carrera de la unique_violation del identityKey: re-buscar (homónimo en
--       BD o fila previa del mismo batch) — idéntico a resolve_riders.
--    4) UPDATE race_uci_results SET globalRiderId = <ficha> para las filas
--       individuales (isTeamEvent=false) de esta carrera cuyo bib == fila.bib
--       y que aún no apunten ahí (IS DISTINCT FROM, no reescribir).
--
--  IDEMPOTENTE: re-ejecutar no duplica fichas (identityKey exacto re-casa) ni
--  reescribe globalRiderId si ya es correcto. Pensada para llamarse al final
--  del upsert (carreras sin startlist) y desde el cron/backfill.
--
--  NO toca eventos por equipos (el bib ahí es de equipo). NO pisa un
--  globalRiderId que la startlist (resolve_uci_results) ya hubiera puesto si
--  ambas corrieran: el UPDATE solo afecta filas con bib coincidente, y para
--  carreras CON startlist se usa 082, no esta — pero aun así el matching por
--  identityKey desemboca en la MISMA ficha.
--
--  Devuelve el recuento estable final (matched, created, unresolved) sobre las
--  filas individuales de la carrera.
CREATE OR REPLACE FUNCTION public.resolve_uci_results_by_name(
  p_race_id text,
  p_gender  text,
  p_rows    jsonb
)
RETURNS TABLE (matched int, created int, unresolved int)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_row        jsonb;
  v_bib        text;
  v_first      text;
  v_last       text;
  v_country    text;
  v_birth      date;
  v_ikey       text;
  v_found      text;
  v_base       text;
  v_candidate  text;
  v_n          int;
  v_created    int := 0;
BEGIN
  IF p_gender NOT IN ('male','female') THEN
    RAISE EXCEPTION 'p_gender debe ser male|female, recibido %', p_gender;
  END IF;

  FOR v_row IN SELECT * FROM jsonb_array_elements(p_rows)
  LOOP
    v_bib     := NULLIF(v_row->>'bib', '');
    v_first   := COALESCE(v_row->>'firstName', '');
    v_last    := COALESCE(v_row->>'lastName', '');
    v_country := NULLIF(lower(COALESCE(v_row->>'countryCode','')), '');
    v_birth   := NULLIF(v_row->>'birthDate','')::date;   -- 'YYYY-MM-DD' o NULL
    v_ikey    := public.compute_identity_key(v_first, v_last);

    -- Sin dorsal numérico o sin nombre útil → no se puede enlazar la fila.
    CONTINUE WHEN v_bib IS NULL OR v_bib !~ '^[0-9]+$' OR v_ikey IS NULL;

    -- 1) ¿Existe ya por identityKey exacto?
    IF p_gender = 'male' THEN
      SELECT id INTO v_found FROM public.riders_men   WHERE "identityKey" = v_ikey LIMIT 1;
    ELSE
      SELECT id INTO v_found FROM public.riders_women WHERE "identityKey" = v_ikey LIMIT 1;
    END IF;

    -- 2) No existe → crear ficha (slug exquisito apellido-nombre por fold_name).
    IF v_found IS NULL THEN
      v_base := regexp_replace(
                  public.fold_name(v_last) || '-' || public.fold_name(v_first),
                  ' ', '-', 'g');
      v_base := regexp_replace(v_base, '-+', '-', 'g');
      v_base := regexp_replace(v_base, '(^-|-$)', '', 'g');
      IF v_base = '' OR v_base = '-' THEN v_base := 'rider'; END IF;

      v_candidate := v_base; v_n := 2;
      LOOP
        IF p_gender = 'male' THEN
          PERFORM 1 FROM public.riders_men   WHERE id = v_candidate;
        ELSE
          PERFORM 1 FROM public.riders_women WHERE id = v_candidate;
        END IF;
        EXIT WHEN NOT FOUND;
        v_candidate := v_base || '-' || v_n; v_n := v_n + 1;
        EXIT WHEN v_n > 200;
      END LOOP;

      BEGIN
        IF p_gender = 'male' THEN
          INSERT INTO public.riders_men   (id, "firstName", "lastName", nationality, "birthDate", source, verified)
          VALUES (v_candidate, v_first, v_last, v_country, v_birth, 'catalog_gold', false);
        ELSE
          INSERT INTO public.riders_women (id, "firstName", "lastName", nationality, "birthDate", source, verified)
          VALUES (v_candidate, v_first, v_last, v_country, v_birth, 'catalog_gold', false);
        END IF;
        v_found := v_candidate;
        v_created := v_created + 1;
      EXCEPTION WHEN unique_violation THEN
        -- El índice UNIQUE de identityKey saltó (homónimo en BD o fila previa
        -- del mismo batch) → re-buscar y enlazar a la ficha existente.
        IF p_gender = 'male' THEN
          SELECT id INTO v_found FROM public.riders_men   WHERE "identityKey" = v_ikey LIMIT 1;
        ELSE
          SELECT id INTO v_found FROM public.riders_women WHERE "identityKey" = v_ikey LIMIT 1;
        END IF;
      END;
    END IF;

    -- 3) Enlazar las filas individuales de esta carrera con este dorsal.
    IF v_found IS NOT NULL THEN
      UPDATE public.race_uci_results r
         SET "globalRiderId" = v_found
        FROM public.race_uci_stages st
       WHERE st.id = r."stageRef"
         AND st."isTeamEvent" = false
         AND r."raceId" = p_race_id
         AND r.bib = v_bib
         AND r."globalRiderId" IS DISTINCT FROM v_found;
    END IF;
  END LOOP;

  -- Recuento estable final sobre las filas individuales de la carrera.
  SELECT
    COUNT(*) FILTER (WHERE r."globalRiderId" IS NOT NULL)::int,
    v_created,
    COUNT(*) FILTER (WHERE r."globalRiderId" IS NULL)::int
  INTO matched, created, unresolved
  FROM public.race_uci_results r
  JOIN public.race_uci_stages st ON st.id = r."stageRef"
  WHERE r."raceId" = p_race_id
    AND st."isTeamEvent" = false;

  RETURN NEXT;
END $$;

COMMENT ON FUNCTION public.resolve_uci_results_by_name(text, text, jsonb) IS
  'Fase 6: resuelve los corredores de race_uci_results de una carrera SIN startlist casando por identityKey desde el propio resultado UCI (nombre/nacionalidad/fecha), creando la ficha que falte (source=catalog_gold, verified=false). Complementa resolve_uci_results (082, por dorsal vía startlist). Idempotente.';

-- Mismos grants que resolve_riders / resolve_uci_results.
REVOKE ALL ON FUNCTION public.resolve_uci_results_by_name(text, text, jsonb) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.resolve_uci_results_by_name(text, text, jsonb) TO authenticated, service_role;
