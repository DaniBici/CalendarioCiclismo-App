-- Creación controlada de los tres equipos que no existían en el catálogo.
-- Cada fila de inscritos fue respaldada antes en
-- private.pending_collective_team_rastreo_20260830_backup.

DO $$
DECLARE
  v_team_id text;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM private.pending_collective_team_rastreo_20260830_backup
    WHERE operation = 'pending-collective-team-rastreo-20260830'
      AND entity = 'startlist_teams'
      AND row_id = 'sl_rJPcuvTZ9iALSCad8s5J_1784106748327_18'
  ) THEN
    RAISE EXCEPTION 'Falta backup de la fila Van Eyck - Belco';
  END IF;

  SELECT r.team_id
  INTO v_team_id
  FROM public.ensure_startlist_team(
    'rJPcuvTZ9iALSCad8s5J', 'Belco-Van Eyck', 'female'
  ) r
  WHERE r.team_id IS NOT NULL
  LIMIT 1;
  IF v_team_id IS NULL THEN
    RAISE EXCEPTION 'No se pudo resolver Belco-Van Eyck';
  END IF;
  UPDATE public.team_name_aliases
  SET alias = 'Belco-Van Eyck', source = 'baloise_ladies_official_2026',
      "sourceUrl" = 'https://www.baloiseladiestour.com/nl', verified = true,
      "updatedAt" = now()
  WHERE "teamId" = v_team_id
    AND year = 2026
    AND "foldedName" = public.fold_team_name('Belco-Van Eyck');
  UPDATE public.startlist_teams
  SET "teamId" = v_team_id
  WHERE id = 'sl_rJPcuvTZ9iALSCad8s5J_1784106748327_18'
    AND "teamId" IS NULL;

  IF NOT EXISTS (
    SELECT 1
    FROM private.pending_collective_team_rastreo_20260830_backup
    WHERE operation = 'pending-collective-team-rastreo-20260830'
      AND entity = 'startlist_teams'
      AND row_id = 'efab832e-d610-48fd-9de9-444f2be5f132'
  ) THEN
    RAISE EXCEPTION 'Falta backup de la fila Mayenne Monbana My Pie';
  END IF;

  SELECT r.team_id
  INTO v_team_id
  FROM public.ensure_startlist_team(
    'tvXsn05qNn1Waz7V9pEi', 'Mayenne-Monbana-Rapido', 'male'
  ) r
  WHERE r.team_id IS NOT NULL
  LIMIT 1;
  IF v_team_id IS NULL THEN
    RAISE EXCEPTION 'No se pudo resolver Mayenne-Monbana-Rapido';
  END IF;
  UPDATE public.team_name_aliases
  SET alias = 'Mayenne-Monbana-Rapido', source = 'kreiz_breizh_official_2026',
      "sourceUrl" = 'https://www.sitekbe.com/2025/equipes/', verified = true,
      "updatedAt" = now()
  WHERE "teamId" = v_team_id
    AND year = 2026
    AND "foldedName" = public.fold_team_name('Mayenne-Monbana-Rapido');
  UPDATE public.startlist_teams
  SET "teamName" = 'Mayenne-Monbana-Rapido', "teamId" = v_team_id
  WHERE id = 'efab832e-d610-48fd-9de9-444f2be5f132'
    AND "teamId" IS NULL;

  IF NOT EXISTS (
    SELECT 1
    FROM private.pending_collective_team_rastreo_20260830_backup
    WHERE operation = 'pending-collective-team-rastreo-20260830'
      AND entity = 'startlist_teams'
      AND row_id = '7a32d089-650d-48a5-a1c6-f4d7effee008'
  ) THEN
    RAISE EXCEPTION 'Falta backup de la fila Team Buffaz Gestion de Patrimoine';
  END IF;

  SELECT r.team_id
  INTO v_team_id
  FROM public.ensure_startlist_team(
    'SfvJ5yGQzAxj2ptaEYCV', 'Team Buffaz Gestion de Patrimoine', 'female'
  ) r
  WHERE r.team_id IS NOT NULL
  LIMIT 1;
  IF v_team_id IS NULL THEN
    RAISE EXCEPTION 'No se pudo resolver Team Buffaz Gestion de Patrimoine';
  END IF;
  UPDATE public.team_name_aliases
  SET alias = 'Team Buffaz Gestion de Patrimoine', source = 'premondiale_official_2026',
      "sourceUrl" = 'https://girodellatoscana.michelafanini.com/squadre/', verified = true,
      "updatedAt" = now()
  WHERE "teamId" = v_team_id
    AND year = 2026
    AND "foldedName" = public.fold_team_name('Team Buffaz Gestion de Patrimoine');
  UPDATE public.startlist_teams
  SET "teamId" = v_team_id
  WHERE id = '7a32d089-650d-48a5-a1c6-f4d7effee008'
    AND "teamId" IS NULL;
END $$;
