-- Las selecciones convocan en startlists; no tienen afiliaciones permanentes.
-- Reparación acotada: dos afiliaciones auditadas el 2026-09-04.
BEGIN;

CREATE OR REPLACE FUNCTION public.guard_regular_team_roster()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_team_id text;
  v_selection boolean;
BEGIN
  IF TG_TABLE_NAME = 'rider_team_affiliations' THEN
    v_team_id := NEW."teamId";
  ELSE
    v_team_id := NEW."currentTeamId";
  END IF;
  IF v_team_id IS NULL THEN RETURN NEW; END IF;

  -- Serializa la asignación con una reclasificación concurrente del equipo.
  SELECT t."teamKind" = 'selection' OR t.category IN ('NTM', 'NTW')
    INTO v_selection
    FROM public.teams t WHERE t.id = v_team_id
    FOR SHARE;
  IF v_selection THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'Las selecciones no admiten plantilla permanente; usa la startlist para sus convocatorias.',
      CONSTRAINT = 'regular_team_roster_only';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.guard_regular_team_roster()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.guard_regular_team_roster() TO service_role;

CREATE TRIGGER guard_regular_team_affiliation
  BEFORE INSERT OR UPDATE ON public.rider_team_affiliations
  FOR EACH ROW EXECUTE FUNCTION public.guard_regular_team_roster();
CREATE TRIGGER guard_regular_current_team_men
  BEFORE INSERT OR UPDATE OF "currentTeamId" ON public.riders_men
  FOR EACH ROW EXECUTE FUNCTION public.guard_regular_team_roster();
CREATE TRIGGER guard_regular_current_team_women
  BEFORE INSERT OR UPDATE OF "currentTeamId" ON public.riders_women
  FOR EACH ROW EXECUTE FUNCTION public.guard_regular_team_roster();

CREATE OR REPLACE FUNCTION public.guard_selection_team_classification()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF (NEW."teamKind" = 'selection' OR NEW.category IN ('NTM', 'NTW'))
     AND (
       EXISTS (SELECT 1 FROM public.rider_team_affiliations WHERE "teamId" = NEW.id)
       OR EXISTS (SELECT 1 FROM public.riders_men WHERE "currentTeamId" = NEW.id)
       OR EXISTS (SELECT 1 FROM public.riders_women WHERE "currentTeamId" = NEW.id)
     ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'Retira las afiliaciones de plantilla antes de convertir el equipo en selección.',
      CONSTRAINT = 'selection_without_roster';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.guard_selection_team_classification()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.guard_selection_team_classification() TO service_role;

CREATE TRIGGER guard_selection_team_classification
  BEFORE UPDATE OF "teamKind", category ON public.teams
  FOR EACH ROW EXECUTE FUNCTION public.guard_selection_team_classification();

CREATE TABLE private.repair_selection_rosters_20260904_backup (
  entity text NOT NULL,
  row_id text NOT NULL,
  row_data jsonb NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (entity, row_id)
);
ALTER TABLE private.repair_selection_rosters_20260904_backup ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE private.repair_selection_rosters_20260904_backup
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT ON TABLE private.repair_selection_rosters_20260904_backup TO service_role;
CREATE POLICY private_backup_deny_api
  ON private.repair_selection_rosters_20260904_backup
  FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

DO $repair$
DECLARE
  v_manifest jsonb := '[
    {"riderId":"ouattara-allassane","teamId":"team_ntm_burkina-faso","updatedAt":"2026-08-29T09:18:03.835636+00:00"},
    {"riderId":"tchumthoua-mouaffo-marc-didier","teamId":"team_ntm_cameroon","updatedAt":"2026-08-29T09:20:21.921163+00:00"}
  ]'::jsonb;
  v_row record;
  v_startlists jsonb;
  v_results jsonb;
  v_count integer;
BEGIN
  INSERT INTO private.repair_selection_rosters_20260904_backup
    VALUES ('manifest', 'prevent-selection-rosters', v_manifest, now());

  FOR v_row IN
    SELECT * FROM jsonb_to_recordset(v_manifest)
      AS m("riderId" text, "teamId" text, "updatedAt" timestamptz)
  LOOP
    PERFORM 1 FROM public.riders_men r
      WHERE r.id = v_row."riderId" AND r."currentTeamId" = v_row."teamId"
        AND r."updatedAt" = v_row."updatedAt" FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Ficha modificada desde la auditoría: %', v_row."riderId"; END IF;
    PERFORM 1 FROM public.rider_team_affiliations a
      WHERE a.id = v_row."riderId" || '__' || v_row."teamId" || '__2026'
        AND a."riderId" = v_row."riderId" AND a."teamId" = v_row."teamId"
        AND a."riderGender" = 'male' AND a.year = 2026
        AND a."dateFrom" IS NULL AND a."dateTo" IS NULL
        AND a."updatedAt" = v_row."updatedAt" FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Afiliación modificada desde la auditoría: %', v_row."riderId"; END IF;
  END LOOP;

  INSERT INTO private.repair_selection_rosters_20260904_backup(entity, row_id, row_data)
    SELECT 'riders_men', r.id, to_jsonb(r) FROM public.riders_men r
    WHERE r.id IN (SELECT m->>'riderId' FROM jsonb_array_elements(v_manifest) m);
  INSERT INTO private.repair_selection_rosters_20260904_backup(entity, row_id, row_data)
    SELECT 'rider_team_affiliations', a.id, to_jsonb(a)
    FROM public.rider_team_affiliations a
    WHERE a.id IN (SELECT (m->>'riderId') || '__' || (m->>'teamId') || '__2026'
                  FROM jsonb_array_elements(v_manifest) m);

  SELECT jsonb_agg(to_jsonb(s) ORDER BY s.id) INTO v_startlists
    FROM public.startlist_riders s
    WHERE s."globalRiderId" IN (SELECT m->>'riderId' FROM jsonb_array_elements(v_manifest) m);
  SELECT jsonb_agg(to_jsonb(r) ORDER BY r.id) INTO v_results
    FROM public.race_uci_results r
    WHERE r."globalRiderId" IN (SELECT m->>'riderId' FROM jsonb_array_elements(v_manifest) m);

  DELETE FROM public.rider_team_affiliations
    WHERE id IN (SELECT (m->>'riderId') || '__' || (m->>'teamId') || '__2026'
                 FROM jsonb_array_elements(v_manifest) m);
  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count <> 2 THEN RAISE EXCEPTION 'La reparación exige exactamente dos afiliaciones'; END IF;
  -- El trigger inverso existente recalcula currentTeamId; no toca la startlist.

  IF EXISTS (SELECT 1 FROM public.rider_team_affiliations a JOIN public.teams t ON t.id = a."teamId"
             WHERE t."teamKind" = 'selection' OR t.category IN ('NTM', 'NTW'))
     OR EXISTS (SELECT 1 FROM public.riders_men r JOIN public.teams t ON t.id = r."currentTeamId"
                WHERE t."teamKind" = 'selection' OR t.category IN ('NTM', 'NTW'))
     OR EXISTS (SELECT 1 FROM public.riders_women r JOIN public.teams t ON t.id = r."currentTeamId"
                WHERE t."teamKind" = 'selection' OR t.category IN ('NTM', 'NTW')) THEN
    RAISE EXCEPTION 'Quedan afiliaciones de selección fuera del manifiesto; revisar sin ampliar el lote';
  END IF;

  IF v_startlists IS DISTINCT FROM (
       SELECT jsonb_agg(to_jsonb(s) ORDER BY s.id) FROM public.startlist_riders s
       WHERE s."globalRiderId" IN (SELECT m->>'riderId' FROM jsonb_array_elements(v_manifest) m))
     OR v_results IS DISTINCT FROM (
       SELECT jsonb_agg(to_jsonb(r) ORDER BY r.id) FROM public.race_uci_results r
       WHERE r."globalRiderId" IN (SELECT m->>'riderId' FROM jsonb_array_elements(v_manifest) m)) THEN
    RAISE EXCEPTION 'La reparación alteró participaciones o resultados';
  END IF;
END;
$repair$;

COMMENT ON FUNCTION public.guard_regular_team_roster() IS
  'Impide afiliaciones y currentTeamId a selecciones nacionales o regionales; no restringe startlists ni corredores.';
COMMENT ON FUNCTION public.guard_selection_team_classification() IS
  'Impide reclasificar como selección un equipo con afiliaciones de cualquier temporada.';
COMMENT ON TABLE private.repair_selection_rosters_20260904_backup IS
  'Manifiesto, dos afiliaciones retiradas y dos fichas antes de recalcular su equipo actual; no contiene cambios de startlist.';

COMMIT;
