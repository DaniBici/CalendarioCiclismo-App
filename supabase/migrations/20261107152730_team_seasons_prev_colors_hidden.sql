-- team_seasons."prevColorsHidden": sin colores en el mercado hasta confirmar la
-- denominación.
--
-- Con "badgeVisible" = false, Fichajes (web, iOS, Android) muestra los colores
-- de la temporada anterior del mismo teamId mientras no se publica el kit de
-- la temporada de mercado. "prevColorsHidden" = true suprime esa reserva: la
-- tarjeta y la cabecera del equipo quedan sin franjas. Uso: estructuras que
-- continúan con un patrocinador nuevo cuya denominación no está confirmada
-- (los colores anteriores corresponden al patrocinador saliente). Sin efecto
-- cuando "badgeVisible" = true. La fila de la temporada anterior no cambia.
--
-- El editor de temporada del panel guarda la columna por admin_save_team_season.
-- Activación inicial: SA Vendée (ex-TotalEnergies) y Hayf Sports / Ukyo
-- (ex-Polti VisitMalta), temporada 2027.

ALTER TABLE public.team_seasons
  ADD COLUMN IF NOT EXISTS "prevColorsHidden" boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.team_seasons."prevColorsHidden" IS
  'Con badgeVisible=false, el mercado de fichajes no usa los colores de la temporada anterior: equipo sin franjas hasta confirmar denominación y colores.';

CREATE OR REPLACE FUNCTION public.admin_save_team_season(p_team_id text, p_year integer, p_season jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_team public.teams%ROWTYPE;
  v_row public.team_seasons%ROWTYPE;
  v_name text := btrim(COALESCE(p_season->>'name', ''));
  v_aliases text := NULLIF(btrim(p_season->>'nameAliases'), '');
  v_category text := NULLIF(p_season->>'category', '');
  v_gender text := NULLIF(p_season->>'gender', '');
  v_uci_code text := NULLIF(upper(btrim(p_season->>'uciCode')), '');
  v_header_bg text := lower(COALESCE(NULLIF(p_season->>'headerBg', ''), '#1f2937'));
  v_header_text text := lower(COALESCE(NULLIF(p_season->>'headerText', ''), '#ffffff'));
  v_torso_center text := lower(COALESCE(NULLIF(p_season->>'badgeTorsoCenter', ''), '#ffffff'));
  v_torso_sides text := lower(COALESCE(NULLIF(p_season->>'badgeTorsoSides', ''), '#000000'));
  v_inner_circle text := NULLIF(lower(p_season->>'badgeInnerCircle'), '');
  v_shorts text := lower(COALESCE(NULLIF(p_season->>'badgeShorts', ''), '#000000'));
  v_translations jsonb := COALESCE(p_season->'translations', '{}'::jsonb);
BEGIN
  PERFORM private.assert_startlist_import_admin();
  IF p_year NOT BETWEEN 1900 AND 2100 OR jsonb_typeof(p_season) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'Temporada no válida' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_team FROM public.teams WHERE id = p_team_id FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Equipo no encontrado' USING ERRCODE = 'P0002'; END IF;
  IF v_team."specialEdition" THEN
    RAISE EXCEPTION 'Las ediciones especiales se editan en su ficha propia' USING ERRCODE = '23514';
  END IF;
  IF v_name = ''
     OR (v_category IS NOT NULL AND v_category NOT IN ('WT','WWT','PT','PRW','CT','CTW','NTM','NTW','CLUBM','CLUBW'))
     OR (v_gender IS NOT NULL AND v_gender NOT IN ('male','female'))
     OR (v_uci_code IS NOT NULL AND v_uci_code !~ '^[^[:space:]]{3}$')
     OR v_header_bg !~ '^#[0-9a-f]{6}$' OR v_header_text !~ '^#[0-9a-f]{6}$'
     OR v_torso_center !~ '^#[0-9a-f]{6}$' OR v_torso_sides !~ '^#[0-9a-f]{6}$'
     OR (v_inner_circle IS NOT NULL AND v_inner_circle !~ '^#[0-9a-f]{6}$')
     OR v_shorts !~ '^#[0-9a-f]{6}$' OR jsonb_typeof(v_translations) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'Datos de temporada no válidos' USING ERRCODE = '22023';
  END IF;

  -- "prevColorsHidden" ausente del payload (panel anterior): se conserva el
  -- valor guardado; en una fila nueva, false.
  INSERT INTO public.team_seasons AS ts (
    id,"teamId",year,name,"nameAliases",category,gender,"uciCode",
    "headerBg","headerText","badgeTorsoCenter","badgeTorsoSides",
    "badgeInnerCircle","badgeShorts",translations,"badgeVisible","continuityDoubt","prevColorsHidden"
  ) VALUES (
    p_team_id || '_' || p_year,p_team_id,p_year,v_name,v_aliases,v_category,v_gender,v_uci_code,
    v_header_bg,v_header_text,v_torso_center,v_torso_sides,v_inner_circle,v_shorts,v_translations,
    COALESCE((p_season->>'badgeVisible')::boolean, true),
    COALESCE((p_season->>'continuityDoubt')::boolean, false),
    COALESCE((p_season->>'prevColorsHidden')::boolean, false)
  )
  ON CONFLICT ("teamId",year) DO UPDATE SET
    name=EXCLUDED.name,"nameAliases"=EXCLUDED."nameAliases",category=EXCLUDED.category,
    gender=EXCLUDED.gender,"uciCode"=EXCLUDED."uciCode","headerBg"=EXCLUDED."headerBg",
    "headerText"=EXCLUDED."headerText","badgeTorsoCenter"=EXCLUDED."badgeTorsoCenter",
    "badgeTorsoSides"=EXCLUDED."badgeTorsoSides","badgeInnerCircle"=EXCLUDED."badgeInnerCircle",
    "badgeShorts"=EXCLUDED."badgeShorts",translations=EXCLUDED.translations,"badgeVisible"=EXCLUDED."badgeVisible",
    "continuityDoubt"=EXCLUDED."continuityDoubt",
    "prevColorsHidden"=CASE WHEN p_season ? 'prevColorsHidden'
      THEN EXCLUDED."prevColorsHidden" ELSE ts."prevColorsHidden" END,
    "updatedAt"=now()
  RETURNING * INTO v_row;
  RETURN to_jsonb(v_row);
END;
$function$;

UPDATE public.team_seasons
   SET "prevColorsHidden" = true, "updatedAt" = now()
 WHERE id IN ('team_1776705081939_olxbwj_2027', 'team_1776705783470_ii0i0m_2027');
