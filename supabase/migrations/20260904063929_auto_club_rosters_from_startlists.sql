-- Altas futuras en clubes desde startlists. No recorre las listas históricas.
BEGIN;

-- Una afiliación curada conserva prioridad sobre las inferidas de startlists.
-- Las afiliaciones de temporada siguen siendo la fuente de currentTeamId.
CREATE OR REPLACE FUNCTION public.recompute_current_team(p_rider_id text, p_gender text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_year integer := extract(year from now())::int;
  v_team text;
BEGIN
  SELECT a."teamId" INTO v_team
  FROM public.rider_team_affiliations a
  JOIN public.teams t ON t.id = a."teamId"
  WHERE a."riderId" = p_rider_id AND a."riderGender" = p_gender AND a.year = v_year
    AND (a."dateFrom" IS NULL OR a."dateFrom" <= CURRENT_DATE)
    AND (a."dateTo" IS NULL OR a."dateTo" >= CURRENT_DATE)
    AND t."teamKind" <> 'selection' AND COALESCE(t.category,'') NOT IN ('NTM','NTW')
  ORDER BY (a.source = 'startlist_club'), a."dateFrom" DESC NULLS LAST,
           a."updatedAt" DESC, a.id
  LIMIT 1;

  IF p_gender = 'male' THEN
    UPDATE public.riders_men SET "currentTeamId" = v_team, "updatedAt" = now()
      WHERE id = p_rider_id AND "currentTeamId" IS DISTINCT FROM v_team;
  ELSIF p_gender = 'female' THEN
    UPDATE public.riders_women SET "currentTeamId" = v_team, "updatedAt" = now()
      WHERE id = p_rider_id AND "currentTeamId" IS DISTINCT FROM v_team;
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.recompute_current_team(text,text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.recompute_current_team(text,text) TO service_role;

CREATE FUNCTION private.add_startlist_club_roster_member(p_startlist_rider_id text)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_member record;
  v_inserted text;
BEGIN
  SELECT sr."globalRiderId" AS rider_id, rc.gender, rc.year, t.id AS team_id
    INTO v_member
  FROM public.startlist_riders sr
  JOIN public.startlist_teams st ON st.id = sr."teamId" AND st."raceId" = sr."raceId"
  JOIN public.races rc ON rc.id = st."raceId"
  JOIN public.teams entry_team ON entry_team.id = st."teamId"
  JOIN public.teams t ON t.id = CASE WHEN entry_team."specialEdition"
                                   THEN entry_team."parentTeamId" ELSE entry_team.id END
  WHERE sr.id = p_startlist_rider_id AND sr."globalRiderId" IS NOT NULL
    AND t."teamKind" = 'club' AND NOT t."specialEdition"
    AND ((rc.gender = 'male' AND t.category = 'CLUBM'
          AND EXISTS (SELECT 1 FROM public.riders_men WHERE id = sr."globalRiderId"))
      OR (rc.gender = 'female' AND t.category = 'CLUBW'
          AND EXISTS (SELECT 1 FROM public.riders_women WHERE id = sr."globalRiderId")))
    AND t.gender = rc.gender AND rc.year IS NOT NULL;
  IF NOT FOUND THEN RETURN; END IF;

  INSERT INTO public.rider_team_affiliations
    (id,"riderId","riderGender","teamId",year,source,verified)
  SELECT v_member.rider_id || '__' || v_member.team_id || '__' || v_member.year,
         v_member.rider_id,v_member.gender,v_member.team_id,v_member.year,'startlist_club',false
  WHERE NOT EXISTS (
    SELECT 1 FROM public.rider_team_affiliations a
    WHERE a."riderId" = v_member.rider_id AND a."riderGender" = v_member.gender
      AND a."teamId" = v_member.team_id AND a.year = v_member.year
  )
  ON CONFLICT (id) DO NOTHING
  RETURNING id INTO v_inserted;

  -- El trigger inverso omite escrituras anidadas. Recalcular explícitamente
  -- mantiene el origen startlist_club sin activar la escritura de vuelta.
  IF v_inserted IS NOT NULL AND v_member.year = extract(year FROM now())::integer THEN
    PERFORM public.recompute_current_team(v_member.rider_id,v_member.gender);
  END IF;
END;
$$;

-- Solo se invoca mediante triggers de las tablas de inscripción. El contexto
-- DEFINER permite mantener la afiliación desde el worker sin darle acceso
-- directo de escritura al catálogo temporal. No se expone ninguna RPC.
CREATE FUNCTION private.sync_startlist_club_roster()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_rider record;
BEGIN
  IF TG_TABLE_NAME = 'startlist_riders' THEN
    PERFORM private.add_startlist_club_roster_member(NEW.id);
  ELSE
    FOR v_rider IN
      SELECT id FROM public.startlist_riders WHERE "teamId" = NEW.id ORDER BY id
    LOOP
      PERFORM private.add_startlist_club_roster_member(v_rider.id);
    END LOOP;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.add_startlist_club_roster_member(text),
  private.sync_startlist_club_roster() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.add_startlist_club_roster_member(text),
  private.sync_startlist_club_roster() TO service_role;

CREATE TRIGGER sync_startlist_rider_club_roster
  AFTER INSERT OR UPDATE OF "globalRiderId","teamId","raceId" ON public.startlist_riders
  FOR EACH ROW EXECUTE FUNCTION private.sync_startlist_club_roster();
CREATE TRIGGER sync_startlist_team_club_roster
  AFTER UPDATE OF "teamId","raceId" ON public.startlist_teams
  FOR EACH ROW WHEN (OLD."teamId" IS DISTINCT FROM NEW."teamId"
                    OR OLD."raceId" IS DISTINCT FROM NEW."raceId")
  EXECUTE FUNCTION private.sync_startlist_club_roster();

COMMENT ON FUNCTION private.sync_startlist_club_roster() IS
  'Cada alta o enlace futuro en una startlist de CLUBM/CLUBW añade la ficha a su plantilla de temporada; excluye selecciones y no borra afiliaciones previas.';
COMMENT ON FUNCTION private.add_startlist_club_roster_member(text) IS
  'Alta idempotente con source=startlist_club y verified=false; conserva afiliaciones curadas y resuelve el club canónico de un maillot especial.';
COMMIT;
