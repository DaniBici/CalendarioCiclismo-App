-- ═══════════════════════════════════════════════════════════════════
--  PUNTOS DEL RANKING UCI EN LAS CLASIFICACIONES
--
--  Fuente: Reglamento UCI de carretera, versión 01.07.2026,
--  artículos 2.10.008 (hombres) y 2.10.017 (mujeres).
--
--  `uciPoints` es un dato DERIVADO del puesto, la clasificación y la
--  carrera. No depende de globalRiderId ni del corredor que ocupe la fila.
--
--  Reglas especiales:
--   · ex-aequo: se suman los puntos de las plazas ocupadas y se dividen
--     entre las filas empatadas;
--   · CRE: la escala se concede al equipo y se divide entre los corredores
--     de ese equipo que terminan, redondeando a centésimas;
--   · WorldTour: la banda se identifica por el nombre canónico de carrera;
--   · una vuelta reducida a una sola etapa solo concede puntos de etapa
--     (art. 2.6.001).
--
--  Las funciones viven en `private`, no son RPC públicas y solo se ejecutan
--  desde triggers internos. La columna sí forma parte de la lectura pública
--  ya autorizada de race_uci_results.
-- ═══════════════════════════════════════════════════════════════════

ALTER TABLE public.race_uci_results
  ADD COLUMN IF NOT EXISTS "uciPoints" numeric(10,2);

COMMENT ON COLUMN public.race_uci_results."uciPoints" IS
  'Puntos UCI derivados de carrera+clasificación+puesto. Admite centésimas por CRE y ex-aequo; NULL = la fila no puntúa.';

-- ─── 1. Escalas de los artículos 2.10.008 / 2.10.017 ─────────────

CREATE OR REPLACE FUNCTION private.uci_points_at(
  p_scale_key text,
  p_position integer
)
RETURNS numeric
LANGUAGE plpgsql
IMMUTABLE
PARALLEL SAFE
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_scale numeric[];
BEGIN
  IF p_position IS NULL OR p_position < 1 THEN
    RETURN NULL;
  END IF;

  CASE p_scale_key
    -- Final WorldTour / Women's WorldTour: cinco bandas por carrera.
    WHEN 'wt_final_tour' THEN
      v_scale := ARRAY[
        1300,1040,880,750,620,520,425,360,295,230,
        190,165,140,110,100,90,85,80,70,60
      ]::numeric[]
      || array_fill(50::numeric, ARRAY[5])
      || array_fill(40::numeric, ARRAY[5])
      || array_fill(35::numeric, ARRAY[10])
      || array_fill(25::numeric, ARRAY[10])
      || array_fill(20::numeric, ARRAY[5])
      || array_fill(15::numeric, ARRAY[5]);
    WHEN 'wt_final_giro_vuelta' THEN
      v_scale := ARRAY[
        1100,885,750,600,495,415,340,285,235,180,
        155,130,110,90,80,75,70,60,55,50
      ]::numeric[]
      || array_fill(50::numeric, ARRAY[5])
      || array_fill(30::numeric, ARRAY[5])
      || array_fill(25::numeric, ARRAY[10])
      || array_fill(20::numeric, ARRAY[10])
      || array_fill(15::numeric, ARRAY[5])
      || array_fill(10::numeric, ARRAY[5]);
    WHEN 'wt_final_monument' THEN
      v_scale := ARRAY[
        800,640,520,440,360,280,240,200,160,135,
        110,95,85,65,55
      ]::numeric[]
      || array_fill(50::numeric, ARRAY[5])
      || array_fill(30::numeric, ARRAY[10])
      || array_fill(15::numeric, ARRAY[20])
      || array_fill(10::numeric, ARRAY[5])
      || array_fill(5::numeric, ARRAY[5]);
    WHEN 'wt_final_500' THEN
      v_scale := ARRAY[
        500,400,325,275,225,175,150,125,100,85,
        70,60,50,40,35
      ]::numeric[]
      || array_fill(30::numeric, ARRAY[5])
      || array_fill(20::numeric, ARRAY[10])
      || array_fill(10::numeric, ARRAY[20])
      || array_fill(5::numeric, ARRAY[5])
      || array_fill(3::numeric, ARRAY[5]);
    WHEN 'wt_final_400' THEN
      v_scale := ARRAY[
        400,320,260,220,180,140,120,100,80,68,
        56,48,40,32,28
      ]::numeric[]
      || array_fill(24::numeric, ARRAY[5])
      || array_fill(16::numeric, ARRAY[10])
      || array_fill(8::numeric, ARRAY[20])
      || array_fill(4::numeric, ARRAY[5])
      || array_fill(2::numeric, ARRAY[5]);

    -- Etapas / prólogos WorldTour.
    WHEN 'wt_stage_tour' THEN
      v_scale := ARRAY[210,150,110,90,70,55,45,40,35,30,25,20,15,10,5]::numeric[];
    WHEN 'wt_stage_giro_vuelta' THEN
      v_scale := ARRAY[180,130,95,80,60,45,40,35,30,25,20,15,10,5,2]::numeric[];
    WHEN 'wt_stage_60' THEN
      v_scale := ARRAY[60,40,30,25,20,15,10,8,5,2]::numeric[];
    WHEN 'wt_stage_50' THEN
      v_scale := ARRAY[50,30,25,20,15,10,8,6,3,1]::numeric[];

    -- Liderato provisional (por jornada).
    WHEN 'wt_leader_tour' THEN v_scale := ARRAY[25]::numeric[];
    WHEN 'wt_leader_giro_vuelta' THEN v_scale := ARRAY[20]::numeric[];
    WHEN 'wt_leader_10' THEN v_scale := ARRAY[10]::numeric[];
    WHEN 'wt_leader_8' THEN v_scale := ARRAY[8]::numeric[];

    -- Puntos y montaña finales de las grandes vueltas.
    WHEN 'wt_secondary_tour' THEN v_scale := ARRAY[210,150,110]::numeric[];
    WHEN 'wt_secondary_giro_vuelta' THEN v_scale := ARRAY[180,130,95]::numeric[];

    -- Calendario continental: final, etapas y liderato.
    WHEN 'pro_final' THEN
      v_scale := ARRAY[250,170,140,120,100,80,70,60,50,40,30,20,10,10,10]::numeric[]
      || array_fill(6::numeric, ARRAY[10])
      || array_fill(5::numeric, ARRAY[5])
      || array_fill(3::numeric, ARRAY[10]);
    WHEN 'class1_final' THEN
      v_scale := ARRAY[125,85,70,60,50,40,35,30,25,20,15,10,5,5,5]::numeric[]
      || array_fill(3::numeric, ARRAY[10]);
    WHEN 'class2_final' THEN
      v_scale := ARRAY[40,30,25,20,15,10,5,3,3,3]::numeric[];
    WHEN 'u23_class2_final' THEN
      v_scale := ARRAY[30,25,20,15,10,5,3,1,1,1]::numeric[];
    WHEN 'pro_stage' THEN v_scale := ARRAY[25,15,10,5,3]::numeric[];
    WHEN 'class1_stage' THEN v_scale := ARRAY[14,5,3]::numeric[];
    WHEN 'class2_stage' THEN v_scale := ARRAY[7,3,1]::numeric[];
    WHEN 'u23_class2_stage' THEN v_scale := ARRAY[5,1]::numeric[];
    WHEN 'pro_leader' THEN v_scale := ARRAY[5]::numeric[];
    WHEN 'class1_leader' THEN v_scale := ARRAY[3]::numeric[];
    WHEN 'class2_leader', 'u23_class2_leader' THEN v_scale := ARRAY[1]::numeric[];

    -- Campeonatos nacionales.
    WHEN 'cn_elite_road_a' THEN
      v_scale := ARRAY[100,75,60,50,40,30,20,10,5,3,3,1,1,1,1]::numeric[];
    WHEN 'cn_elite_road_b' THEN
      v_scale := ARRAY[50,30,20,15,10,5,3,3,1,1]::numeric[];
    WHEN 'cn_elite_itt_a' THEN
      v_scale := ARRAY[50,30,20,15,10,5,3,3,1,1]::numeric[];
    WHEN 'cn_elite_itt_b' THEN
      v_scale := ARRAY[25,15,10,5,3]::numeric[];
    WHEN 'cn_u23_road' THEN
      v_scale := ARRAY[50,30,20,15,10,5,3,3,1,1]::numeric[];
    WHEN 'cn_u23_itt' THEN
      v_scale := ARRAY[25,15,10,5,3]::numeric[];

    -- Campeonatos continentales / juegos continentales.
    WHEN 'cc_elite_road' THEN
      v_scale := ARRAY[
        250,200,150,125,100,90,80,70,60,50,
        40,35,30,25,20,15,10,5,5,5
      ]::numeric[]
      || array_fill(5::numeric, ARRAY[10])
      || array_fill(3::numeric, ARRAY[5])
      || array_fill(1::numeric, ARRAY[5]);
    WHEN 'cc_elite_itt', 'cc_ttt' THEN
      v_scale := ARRAY[70,55,40,30,25,20,15,10,5,3]::numeric[];
    WHEN 'cc_u23_road' THEN
      v_scale := ARRAY[125,85,70,60,50,40,35,30,25,20,15,10,5,5,5,3,3,3,3,3]::numeric[];
    WHEN 'cc_u23_itt' THEN
      v_scale := ARRAY[50,30,20,15,10,5,3,3,1,1]::numeric[];

    -- Juegos Olímpicos / Mundiales.
    WHEN 'wc_elite_road' THEN
      v_scale := ARRAY[
        900,715,600,490,410,340,265,225,190,150,
        130,105,90,75,60,50,45,45,45,45,45
      ]::numeric[]
      || array_fill(30::numeric, ARRAY[10])
      || array_fill(15::numeric, ARRAY[19])
      || array_fill(10::numeric, ARRAY[5])
      || array_fill(5::numeric, ARRAY[5]);
    WHEN 'wc_elite_itt' THEN
      v_scale := ARRAY[455,325,260,195,165,130,110,90,80,65,55,40,30,25,20,15,10,10,5,5,3,3,3,3,3]::numeric[];
    WHEN 'wc_u23_road' THEN
      v_scale := ARRAY[200,150,125,100,85,70,60,50,40,35,30,25,20,15,10]::numeric[]
      || array_fill(5::numeric, ARRAY[15])
      || array_fill(3::numeric, ARRAY[10]);
    WHEN 'wc_u23_itt' THEN
      v_scale := ARRAY[125,85,70,60,50,40,35,30,25,20,15,10,5,5,5,3,3,3,3,3]::numeric[];
    WHEN 'wc_ttt' THEN
      v_scale := ARRAY[300,250,200,150,125,100,85,75,60,50,40,30,25,15,10,10,10,10,10,10,5,5,5,5,5]::numeric[];
    ELSE
      RETURN NULL;
  END CASE;

  RETURN v_scale[p_position];
END;
$$;

REVOKE ALL ON FUNCTION private.uci_points_at(text, integer)
  FROM PUBLIC, anon, authenticated;

-- ─── 2. Bandas WorldTour identificadas por el nombre de carrera ──

CREATE OR REPLACE FUNCTION private.uci_worldtour_scale_key(
  p_race_name text,
  p_context text
)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
PARALLEL SAFE
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_name text := public.fold_name(p_race_name);
  v_is_tour boolean;
  v_is_giro_vuelta boolean;
  v_is_monument boolean;
  v_is_500 boolean;
  v_is_stage_60 boolean;
BEGIN
  v_is_tour :=
    v_name LIKE '%tour de france%' OR v_name LIKE '%tour de francia%';
  v_is_giro_vuelta :=
    v_name LIKE '%giro de italia%'
    OR v_name LIKE '%giro d italia%'
    OR v_name = 'la vuelta'
    OR v_name LIKE '%vuelta a espana%'
    OR v_name LIKE '%vuelta espana femenina%'
    OR v_name LIKE 'la vuelta femenina%';
  v_is_monument :=
    v_name LIKE '%milan san remo%'
    OR v_name LIKE '%sanremo women%'
    OR v_name LIKE '%ronde van vlaanderen%'
    OR v_name LIKE '%tour de flandes%'
    OR v_name LIKE '%tour des flandres%'
    OR v_name LIKE '%paris roubaix%'
    OR v_name LIKE '%lieja bastona lieja%'
    OR v_name LIKE '%liege bastogne liege%'
    OR v_name LIKE '%il lombardia%';
  v_is_500 :=
    v_name LIKE '%tour down under%'
    OR v_name LIKE '%uae tour%'
    OR v_name LIKE '%strade bianche%'
    OR v_name LIKE '%paris nice%'
    OR v_name LIKE '%paris niza%'
    OR v_name LIKE '%tirreno adriatico%'
    OR v_name LIKE '%in flanders fields%'
    OR v_name LIKE '%gante wevelgem%'
    OR v_name LIKE '%middelkerke%wevelgem%'
    OR v_name LIKE '%amstel gold%'
    OR v_name LIKE '%flecha valona%'
    OR v_name LIKE '%fleche wallonne%'
    OR v_name LIKE '%tour auvernia%'
    OR v_name LIKE '%dauphine%'
    OR v_name LIKE '%tour de romandia%'
    OR v_name LIKE '%tour de suisse%'
    OR v_name LIKE '%vuelta a suiza%'
    OR v_name LIKE '%gp quebec%'
    OR v_name LIKE '%grand prix cycliste de quebec%'
    OR v_name LIKE '%gp montreal%'
    OR v_name LIKE '%grand prix cycliste de montreal%'
    OR v_name LIKE '%trofeo alfredo binda%';
  v_is_stage_60 :=
    v_name LIKE '%tour down under%'
    OR v_name LIKE '%uae tour%'
    OR v_name LIKE '%paris nice%'
    OR v_name LIKE '%paris niza%'
    OR v_name LIKE '%tirreno adriatico%'
    OR v_name LIKE '%tour de romandia%'
    OR v_name LIKE '%tour auvernia%'
    OR v_name LIKE '%dauphine%'
    OR v_name LIKE '%tour de suisse%'
    OR v_name LIKE '%vuelta a suiza%';

  CASE p_context
    WHEN 'final' THEN
      IF v_is_tour THEN RETURN 'wt_final_tour'; END IF;
      IF v_is_giro_vuelta THEN RETURN 'wt_final_giro_vuelta'; END IF;
      IF v_is_monument THEN RETURN 'wt_final_monument'; END IF;
      IF v_is_500 THEN RETURN 'wt_final_500'; END IF;
      RETURN 'wt_final_400';
    WHEN 'stage' THEN
      IF v_is_tour THEN RETURN 'wt_stage_tour'; END IF;
      IF v_is_giro_vuelta THEN RETURN 'wt_stage_giro_vuelta'; END IF;
      IF v_is_stage_60 THEN RETURN 'wt_stage_60'; END IF;
      RETURN 'wt_stage_50';
    WHEN 'leader' THEN
      IF v_is_tour THEN RETURN 'wt_leader_tour'; END IF;
      IF v_is_giro_vuelta THEN RETURN 'wt_leader_giro_vuelta'; END IF;
      IF v_is_stage_60 THEN RETURN 'wt_leader_10'; END IF;
      RETURN 'wt_leader_8';
    WHEN 'secondary' THEN
      IF v_is_tour THEN RETURN 'wt_secondary_tour'; END IF;
      IF v_is_giro_vuelta THEN RETURN 'wt_secondary_giro_vuelta'; END IF;
      RETURN NULL;
    ELSE
      RETURN NULL;
  END CASE;
END;
$$;

REVOKE ALL ON FUNCTION private.uci_worldtour_scale_key(text, text)
  FROM PUBLIC, anon, authenticated;

-- En 2026, A = nación con al menos un participante en la prueba élite
-- en línea del Mundial de Kigali 2025. Los dos inventarios salen de las
-- listas de salida oficiales Tissot/UCI. La regla se actualiza anualmente:
-- para un año aún no configurado se devuelve NULL y nunca se inventa A/B.
CREATE OR REPLACE FUNCTION private.uci_cn_category_a(
  p_year integer,
  p_gender text,
  p_country_code text
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT CASE
    WHEN p_year <> 2026 OR p_country_code IS NULL THEN NULL
    WHEN p_gender = 'female' THEN upper(p_country_code) = ANY (ARRAY[
      'AF','AT','AU','BE','BJ','BW','CA','CH','CN','CO','DE','DK','ES','ET',
      'FR','GB','GN','GR','GT','HK','HU','IT','KE','KM','KZ','MU','MX','NL',
      'NO','NZ','PL','RW','SE','SI','SN','TZ','TT','UA','UG','US','UZ','VE',
      'ZA'
    ]::text[])
    ELSE upper(p_country_code) = ANY (ARRAY[
      'AU','BE','BR','BZ','CA','CH','CN','CO','CR','CZ','DE','DK','DZ','EC',
      'EE','ER','ES','FR','GB','GD','GR','GT','GY','HU','IE','IL','IT','JP',
      'KE','LV','MC','ML','MN','MU','MX','NL','NO','PA','PT','RO','RS','RW',
      'SI','SK','SL','SN','ST','TH','TR','UA','UG','US','UZ','VE','ZA'
    ]::text[])
  END
$$;

REVOKE ALL ON FUNCTION private.uci_cn_category_a(integer, text, text)
  FROM PUBLIC, anon, authenticated;

-- ─── 3. Cálculo de una clasificación completa ────────────────────

CREATE OR REPLACE FUNCTION private.refresh_uci_points_for_stage(
  p_stage_ref text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_race_name text;
  v_gender text;
  v_category text;
  v_country_code text;
  v_year integer;
  v_race_format text;
  v_is_grand_tour boolean;
  v_class_kind text;
  v_stage_number integer;
  v_is_final_classification boolean;
  v_event_name text;
  v_race_type text;
  v_primary_type text;
  v_active_days integer;
  v_is_one_day boolean;
  v_is_final boolean;
  v_allow_overall boolean;
  v_is_ttt boolean;
  v_is_itt boolean;
  v_is_u23 boolean;
  v_split_team boolean := false;
  v_name_context text;
  v_scale_key text;
  v_cn_a boolean;
BEGIN
  -- Limpiar primero: un cambio de categoría/tipo nunca deja puntos obsoletos.
  UPDATE public.race_uci_results
  SET "uciPoints" = NULL
  WHERE "stageRef" = p_stage_ref
    AND "uciPoints" IS NOT NULL;

  SELECT
    r.name, r.gender, r."uciCategory", r."countryCode", r.year,
    r."raceFormat", r."isGrandTour",
    s."classKind", s."stageNumber", s."isFinalClassification",
    s."eventName", s."raceType", rd."primaryType",
    (
      SELECT count(*)::integer
      FROM public.race_days all_rd
      WHERE all_rd."raceId" = r.id
        AND NOT all_rd."isRestDay"
        AND NOT all_rd."isCancelledDay"
    )
  INTO
    v_race_name, v_gender, v_category, v_country_code, v_year,
    v_race_format, v_is_grand_tour,
    v_class_kind, v_stage_number, v_is_final_classification,
    v_event_name, v_race_type, v_primary_type, v_active_days
  FROM public.race_uci_stages s
  JOIN public.races r ON r.id = s."raceId"
  LEFT JOIN public.race_days rd ON rd.id = s."raceDayId"
  WHERE s.id = p_stage_ref;

  IF NOT FOUND OR v_category IS NULL THEN
    RETURN;
  END IF;

  v_name_context := public.fold_name(
    coalesce(v_race_name, '') || ' ' || coalesce(v_event_name, '')
  );
  v_is_one_day := v_race_format = 'one_day';
  v_is_final := v_is_one_day
    OR v_is_final_classification
    OR v_stage_number IS NULL;
  v_allow_overall := v_is_one_day OR v_active_days = 0 OR v_active_days > 1;
  v_is_ttt :=
    lower(coalesce(v_primary_type, '')) = 'ttt'
    OR upper(coalesce(v_race_type, '')) = 'TTT'
    OR v_name_context LIKE '%team time trial%'
    OR v_name_context LIKE '%contrarreloj por equipos%'
    OR v_name_context LIKE '%crono por equipos%';
  v_is_itt := NOT v_is_ttt AND (
    lower(coalesce(v_primary_type, '')) = 'itt'
    OR upper(coalesce(v_race_type, '')) = 'ITT'
    OR v_name_context LIKE '%individual time trial%'
    OR v_name_context LIKE '% contrarreloj individual%'
    OR v_name_context LIKE '% cri %'
    OR v_name_context LIKE '% cri'
  );
  v_is_u23 :=
    v_category IN ('1.2U','2.2U')
    OR v_name_context LIKE '%sub23%'
    OR v_name_context LIKE '%sub 23%'
    OR v_name_context LIKE '%u23%'
    OR v_name_context LIKE '%under 23%';

  -- WorldTour y Women's WorldTour.
  IF v_category IN ('1.UWT','2.UWT','1.WWT','2.WWT') THEN
    IF v_class_kind = 'stage' AND NOT v_is_one_day THEN
      v_scale_key := private.uci_worldtour_scale_key(v_race_name, 'stage');
      v_split_team := v_is_ttt;
    ELSIF v_class_kind = 'gc' AND NOT v_is_final AND v_allow_overall THEN
      v_scale_key := private.uci_worldtour_scale_key(v_race_name, 'leader');
    ELSIF v_is_final
          AND v_class_kind IN ('gc','stage')
          AND v_allow_overall THEN
      v_scale_key := private.uci_worldtour_scale_key(v_race_name, 'final');
      v_split_team := v_is_ttt AND v_is_one_day;
    ELSIF v_is_final
          AND v_class_kind IN ('points','kom')
          AND v_is_grand_tour
          AND v_allow_overall THEN
      v_scale_key := private.uci_worldtour_scale_key(v_race_name, 'secondary');
    END IF;

  -- ProSeries y clases continentales.
  ELSIF v_category IN (
    '1.Pro','2.Pro','1.1','2.1','1.2','2.2','1.2U','2.2U'
  ) THEN
    IF v_class_kind = 'stage' AND NOT v_is_one_day THEN
      v_scale_key := CASE
        WHEN v_category = '2.Pro' THEN 'pro_stage'
        WHEN v_category = '2.1' THEN 'class1_stage'
        WHEN v_category = '2.2U' THEN 'u23_class2_stage'
        WHEN v_category = '2.2' THEN 'class2_stage'
      END;
      v_split_team := v_is_ttt;
    ELSIF v_class_kind = 'gc' AND NOT v_is_final AND v_allow_overall THEN
      v_scale_key := CASE
        WHEN v_category = '2.Pro' THEN 'pro_leader'
        WHEN v_category = '2.1' THEN 'class1_leader'
        WHEN v_category = '2.2U' THEN 'u23_class2_leader'
        WHEN v_category = '2.2' THEN 'class2_leader'
      END;
    ELSIF v_is_final
          AND v_class_kind IN ('gc','stage')
          AND v_allow_overall THEN
      v_scale_key := CASE
        WHEN v_category IN ('1.Pro','2.Pro') THEN 'pro_final'
        WHEN v_category IN ('1.1','2.1') THEN 'class1_final'
        WHEN v_category IN ('1.2U','2.2U') THEN 'u23_class2_final'
        WHEN v_category IN ('1.2','2.2') THEN 'class2_final'
      END;
      v_split_team := v_is_ttt AND v_is_one_day;
    END IF;

  -- Campeonatos nacionales.
  ELSIF v_category = 'CN'
        AND v_is_final
        AND v_class_kind IN ('gc','stage') THEN
    IF v_is_u23 THEN
      v_scale_key := CASE WHEN v_is_itt THEN 'cn_u23_itt' ELSE 'cn_u23_road' END;
    ELSE
      v_cn_a := private.uci_cn_category_a(v_year, v_gender, v_country_code);
      IF v_cn_a IS NOT NULL THEN
        v_scale_key := CASE
          WHEN v_is_itt AND v_cn_a THEN 'cn_elite_itt_a'
          WHEN v_is_itt THEN 'cn_elite_itt_b'
          WHEN v_cn_a THEN 'cn_elite_road_a'
          ELSE 'cn_elite_road_b'
        END;
      END IF;
    END IF;

  -- Campeonatos / juegos continentales.
  ELSIF v_category IN ('CC','JC')
        AND v_is_final
        AND v_class_kind IN ('gc','stage') THEN
    v_scale_key := CASE
      WHEN v_is_ttt THEN 'cc_ttt'
      WHEN v_is_u23 AND v_is_itt THEN 'cc_u23_itt'
      WHEN v_is_u23 THEN 'cc_u23_road'
      WHEN v_is_itt THEN 'cc_elite_itt'
      ELSE 'cc_elite_road'
    END;
    v_split_team := v_is_ttt;

  -- Mundiales / Juegos Olímpicos.
  ELSIF v_category IN ('WC','CM','JO')
        AND v_is_final
        AND v_class_kind IN ('gc','stage') THEN
    v_scale_key := CASE
      WHEN v_is_ttt THEN 'wc_ttt'
      WHEN v_is_u23 AND v_is_itt THEN 'wc_u23_itt'
      WHEN v_is_u23 THEN 'wc_u23_road'
      WHEN v_is_itt THEN 'wc_elite_itt'
      ELSE 'wc_elite_road'
    END;
    v_split_team := v_is_ttt;
  END IF;

  IF v_scale_key IS NULL THEN
    RETURN;
  END IF;

  IF v_split_team THEN
    -- Dos codificaciones reales de CRE:
    --  A) todos los corredores repiten el puesto del equipo;
    --  B) solo el líder lleva puesto y sus compañeros llevan rank=NULL.
    -- La startlist resuelve el equipo de forma preferente. Sin ella, el
    -- fallback reproduce el agrupamiento por continuidad usado por las apps.
    WITH base AS (
      SELECT
        rr.id,
        rr.rank,
        rr.irm,
        rr."sortOrder",
        rr."timeText",
        rr."teamId",
        slr."teamId" AS startlist_team_id,
        lag(rr.rank) OVER (
          ORDER BY rr."sortOrder" NULLS LAST, rr.id
        ) AS previous_rank,
        count(*) FILTER (WHERE rr.rank IS NOT NULL) OVER () AS ranked_rows,
        count(*) OVER () AS total_rows
      FROM public.race_uci_results rr
      LEFT JOIN public.startlist_riders slr
        ON slr."raceId" = rr."raceId"
       AND slr.dorsal = CASE
         WHEN rr.bib ~ '^[0-9]+$' THEN rr.bib::integer
       END
      WHERE rr."stageRef" = p_stage_ref
    ),
    grouped AS (
      SELECT
        b.*,
        CASE
          WHEN b.startlist_team_id IS NOT NULL
            THEN 'sl:' || b.startlist_team_id
          WHEN b."teamId" IS NOT NULL
            THEN 'manual:' || b."teamId"
          WHEN b.ranked_rows < b.total_rows
            THEN 'seq:' || sum(
              CASE WHEN b.rank IS NOT NULL THEN 1 ELSE 0 END
            ) OVER (ORDER BY b."sortOrder" NULLS LAST, b.id)
          ELSE 'rank:' || sum(
            CASE WHEN b.rank IS DISTINCT FROM b.previous_rank THEN 1 ELSE 0 END
          ) OVER (ORDER BY b."sortOrder" NULLS LAST, b.id)
        END AS team_key,
        upper(coalesce(b.irm, '')) NOT IN ('DNF','ABD','DNS','OTL','DSQ')
          AS is_finisher
      FROM base b
    ),
    team_summary AS (
      SELECT
        team_key,
        min(rank) FILTER (WHERE rank IS NOT NULL) AS team_rank,
        count(*) FILTER (WHERE is_finisher) AS finishers
      FROM grouped
      GROUP BY team_key
    ),
    tied_teams AS (
      SELECT
        ts.*,
        count(*) OVER (PARTITION BY ts.team_rank) AS tie_count
      FROM team_summary ts
      WHERE ts.team_rank IS NOT NULL
        AND ts.finishers > 0
    ),
    team_awards AS (
      SELECT
        tt.team_key,
        NULLIF((
          SELECT sum(coalesce(private.uci_points_at(v_scale_key, pos::integer), 0))
          FROM generate_series(
            tt.team_rank,
            tt.team_rank + tt.tie_count - 1
          ) AS pos
        ), 0) / tt.tie_count / tt.finishers AS per_rider_points
      FROM tied_teams tt
    ),
    row_awards AS (
      SELECT
        g.id,
        CASE WHEN g.is_finisher
          THEN round(ta.per_rider_points, 2)
          ELSE NULL
        END AS points
      FROM grouped g
      JOIN team_awards ta ON ta.team_key = g.team_key
    )
    UPDATE public.race_uci_results rr
    SET "uciPoints" = ra.points
    FROM row_awards ra
    WHERE rr.id = ra.id
      AND ra.points IS NOT NULL;
  ELSE
    -- Ex-aequo individual: una igualdad en rank ocupa rank..rank+n-1.
    WITH ranked AS (
      SELECT
        rr.id,
        rr.rank,
        count(*) OVER (PARTITION BY rr.rank) AS tie_count
      FROM public.race_uci_results rr
      WHERE rr."stageRef" = p_stage_ref
        AND rr.rank IS NOT NULL
        AND upper(coalesce(rr.irm, '')) NOT IN ('DNF','ABD','DNS','OTL','DSQ')
    ),
    awards AS (
      SELECT
        r.id,
        round(NULLIF((
          SELECT sum(coalesce(private.uci_points_at(v_scale_key, pos::integer), 0))
          FROM generate_series(r.rank, r.rank + r.tie_count - 1) AS pos
        ), 0) / r.tie_count, 2) AS points
      FROM ranked r
    )
    UPDATE public.race_uci_results rr
    SET "uciPoints" = a.points
    FROM awards a
    WHERE rr.id = a.id
      AND a.points IS NOT NULL;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION private.refresh_uci_points_for_stage(text)
  FROM PUBLIC, anon, authenticated;

-- ─── 4. Triggers: cualquier fuente obtiene el mismo cálculo ──────

CREATE OR REPLACE FUNCTION private.trg_uci_points_from_new_results()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_stage_ref text;
BEGIN
  FOR v_stage_ref IN
    SELECT DISTINCT "stageRef" FROM new_rows
  LOOP
    PERFORM private.refresh_uci_points_for_stage(v_stage_ref);
  END LOOP;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION private.trg_uci_points_from_old_results()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_stage_ref text;
BEGIN
  FOR v_stage_ref IN
    SELECT DISTINCT "stageRef" FROM old_rows
  LOOP
    PERFORM private.refresh_uci_points_for_stage(v_stage_ref);
  END LOOP;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION private.trg_uci_points_from_updated_results()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_stage_ref text;
BEGIN
  -- Las actualizaciones internas de uciPoints y los enlaces de corredor no
  -- recalculan. Solo los campos capaces de cambiar posición/CRE.
  IF NOT EXISTS (
    SELECT 1
    FROM new_rows n
    FULL JOIN old_rows o USING (id)
    WHERE ROW(
      n."stageRef", n.rank, n."sortOrder", n.irm, n.bib, n."teamId"
    ) IS DISTINCT FROM ROW(
      o."stageRef", o.rank, o."sortOrder", o.irm, o.bib, o."teamId"
    )
  ) THEN
    RETURN NULL;
  END IF;

  FOR v_stage_ref IN
    SELECT "stageRef" FROM new_rows
    UNION
    SELECT "stageRef" FROM old_rows
  LOOP
    PERFORM private.refresh_uci_points_for_stage(v_stage_ref);
  END LOOP;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS race_uci_results_points_insert
  ON public.race_uci_results;
CREATE TRIGGER race_uci_results_points_insert
  AFTER INSERT ON public.race_uci_results
  REFERENCING NEW TABLE AS new_rows
  FOR EACH STATEMENT
  EXECUTE FUNCTION private.trg_uci_points_from_new_results();

DROP TRIGGER IF EXISTS race_uci_results_points_delete
  ON public.race_uci_results;
CREATE TRIGGER race_uci_results_points_delete
  AFTER DELETE ON public.race_uci_results
  REFERENCING OLD TABLE AS old_rows
  FOR EACH STATEMENT
  EXECUTE FUNCTION private.trg_uci_points_from_old_results();

DROP TRIGGER IF EXISTS race_uci_results_points_update
  ON public.race_uci_results;
CREATE TRIGGER race_uci_results_points_update
  AFTER UPDATE ON public.race_uci_results
  REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows
  FOR EACH STATEMENT
  EXECUTE FUNCTION private.trg_uci_points_from_updated_results();

CREATE OR REPLACE FUNCTION private.trg_uci_points_from_stage()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_stage_ref text;
BEGIN
  -- Al aparecer la pseudo-final, recalcular también las generales diarias
  -- de la carrera. En el resto de casos basta la clasificación afectada.
  IF NEW."isFinalClassification" THEN
    FOR v_stage_ref IN
      SELECT id
      FROM public.race_uci_stages
      WHERE "raceId" = NEW."raceId"
    LOOP
      PERFORM private.refresh_uci_points_for_stage(v_stage_ref);
    END LOOP;
  ELSE
    PERFORM private.refresh_uci_points_for_stage(NEW.id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS race_uci_stages_points_metadata
  ON public.race_uci_stages;
CREATE TRIGGER race_uci_stages_points_metadata
  AFTER INSERT OR UPDATE OF
    "raceId", "raceDayId", "classKind", scope, "stageNumber",
    "isFinalClassification", "eventName", "raceType"
  ON public.race_uci_stages
  FOR EACH ROW
  EXECUTE FUNCTION private.trg_uci_points_from_stage();

CREATE OR REPLACE FUNCTION private.trg_uci_points_from_race()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_stage_ref text;
BEGIN
  FOR v_stage_ref IN
    SELECT id
    FROM public.race_uci_stages
    WHERE "raceId" = NEW.id
  LOOP
    PERFORM private.refresh_uci_points_for_stage(v_stage_ref);
  END LOOP;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS races_points_metadata ON public.races;
CREATE TRIGGER races_points_metadata
  AFTER UPDATE OF
    name, gender, "uciCategory", "countryCode", year,
    "raceFormat", "isGrandTour"
  ON public.races
  FOR EACH ROW
  EXECUTE FUNCTION private.trg_uci_points_from_race();

CREATE OR REPLACE FUNCTION private.trg_uci_points_from_race_day()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_race_id text := CASE
    WHEN TG_OP = 'DELETE' THEN OLD."raceId"
    ELSE NEW."raceId"
  END;
  v_stage_ref text;
BEGIN
  IF TG_OP = 'UPDATE'
     AND ROW(NEW."raceId", NEW."primaryType", NEW."isCancelledDay", NEW."isRestDay")
       IS NOT DISTINCT FROM
       ROW(OLD."raceId", OLD."primaryType", OLD."isCancelledDay", OLD."isRestDay") THEN
    RETURN NEW;
  END IF;

  -- Cancelar/recuperar una jornada cambia la duración efectiva de la vuelta
  -- (art. 2.6.001), por lo que afecta también a generales de otros días.
  FOR v_stage_ref IN
    SELECT s.id
    FROM public.race_uci_stages s
    WHERE s."raceId" = v_race_id
  LOOP
    PERFORM private.refresh_uci_points_for_stage(v_stage_ref);
  END LOOP;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS race_days_points_metadata ON public.race_days;
CREATE TRIGGER race_days_points_metadata
  AFTER INSERT OR UPDATE OR DELETE
  ON public.race_days
  FOR EACH ROW
  EXECUTE FUNCTION private.trg_uci_points_from_race_day();

-- Privilegio mínimo explícito para todas las funciones nuevas: ninguno fuera
-- de sus triggers internos. PostgreSQL concede EXECUTE a PUBLIC por defecto.
REVOKE ALL ON FUNCTION private.trg_uci_points_from_new_results()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.trg_uci_points_from_old_results()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.trg_uci_points_from_updated_results()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.trg_uci_points_from_stage()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.trg_uci_points_from_race()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.trg_uci_points_from_race_day()
  FROM PUBLIC, anon, authenticated;

-- ─── 5. Backfill de todas las clasificaciones visibles existentes ─

DO $$
DECLARE
  v_stage_ref text;
BEGIN
  FOR v_stage_ref IN
    SELECT DISTINCT s.id
    FROM public.race_uci_stages s
    WHERE s."keepForWeb"
      AND EXISTS (
        SELECT 1
        FROM public.race_uci_results rr
        WHERE rr."stageRef" = s.id
      )
  LOOP
    PERFORM private.refresh_uci_points_for_stage(v_stage_ref);
  END LOOP;
END
$$;
