-- Historial de nombres de corredores. Plan: docs/plans/historial-nombres-corredores.md.
--
-- La ficha (riders_men, riders_women) guarda el nombre actual. Cada fila de
-- rider_name_history es un nombre anterior y el último día en que estuvo vigente
-- ("validTo"). El nombre de un corredor en una carrera es el de la fila con la menor
-- "validTo" mayor o igual que races."startDate"; si no hay ninguna, el de la ficha.
-- La regla vive solo en startlist_riders_resolved. Con la tabla vacía, la vista
-- devuelve lo mismo que antes.

CREATE TABLE public.rider_name_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "riderId" text NOT NULL,
  "riderGender" text NOT NULL CHECK ("riderGender" IN ('male', 'female')),
  "firstName" text NOT NULL CHECK (btrim("firstName") <> ''),
  "lastName" text NOT NULL CHECK (btrim("lastName") <> ''),
  "validTo" date NOT NULL,
  reason text,
  "sourceUrl" text,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  UNIQUE ("riderGender", "riderId", "validTo")
);

COMMENT ON TABLE public.rider_name_history IS
  'Nombres anteriores de un corredor. La ficha guarda el actual. Una carrera usa la fila con la menor validTo mayor o igual que races.startDate; sin fila, el nombre de la ficha. Se escribe con admin_change_rider_name.';
COMMENT ON COLUMN public.rider_name_history."validTo" IS
  'Último día en que este nombre estaba vigente.';

ALTER TABLE public.rider_name_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY public_read_rider_name_history ON public.rider_name_history
  FOR SELECT TO anon, authenticated USING (true);

REVOKE ALL ON public.rider_name_history FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.rider_name_history TO anon, authenticated, service_role, cc_publicador;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.rider_name_history TO cc_agent;

-- Vista de inscripciones: el nombre vigente el día de la carrera. Mismas columnas,
-- tipos y propiedades que antes.
CREATE OR REPLACE VIEW public.startlist_riders_resolved
WITH (security_invoker = true) AS
 SELECT sr.id,
    sr."teamId",
    sr."raceId",
    sr.dorsal,
    COALESCE(NULLIF(hist."firstName", ''::text), NULLIF(
        CASE
            WHEN resolved.gender = 'male'::text THEN rm."firstName"
            WHEN resolved.gender = 'female'::text THEN rw."firstName"
            ELSE NULL::text
        END, ''::text), sr."firstName") AS "firstName",
    COALESCE(NULLIF(hist."lastName", ''::text), NULLIF(
        CASE
            WHEN resolved.gender = 'male'::text THEN rm."lastName"
            WHEN resolved.gender = 'female'::text THEN rw."lastName"
            ELSE NULL::text
        END, ''::text), sr."lastName") AS "lastName",
    sr."createdAt",
        CASE
            WHEN r."uciCategory" = 'CN'::text THEN COALESCE(NULLIF(
            CASE
                WHEN resolved.gender = 'male'::text THEN rm.nationality
                WHEN resolved.gender = 'female'::text THEN rw.nationality
                ELSE NULL::text
            END, ''::text), NULLIF(sr."countryCode", ''::text))
            ELSE COALESCE(NULLIF(sr."countryCode", ''::text),
            CASE
                WHEN resolved.gender = 'male'::text THEN rm.nationality
                WHEN resolved.gender = 'female'::text THEN rw.nationality
                ELSE NULL::text
            END)
        END AS "countryCode",
    sr."globalRiderId",
    COALESCE(
        CASE
            WHEN resolved.gender = 'male'::text THEN rm.verified
            WHEN resolved.gender = 'female'::text THEN rw.verified
            ELSE NULL::boolean
        END, false) AS verified,
    COALESCE(
        CASE
            WHEN resolved.gender = 'male'::text THEN rm.source
            WHEN resolved.gender = 'female'::text THEN rw.source
            ELSE NULL::text
        END, 'snapshot_only'::text) AS source,
    NULL::date AS "birthDate",
        CASE
            WHEN resolved.gender = 'male'::text THEN rm."currentTeamId"
            WHEN resolved.gender = 'female'::text THEN rw."currentTeamId"
            ELSE NULL::text
        END AS "currentTeamId",
    resolved.gender AS race_gender
   FROM public.startlist_riders sr
     JOIN public.races r ON r.id = sr."raceId"
     LEFT JOIN public.riders_men rm ON (r.gender = 'male'::text OR r.gender IS NULL) AND rm.id = sr."globalRiderId"
     LEFT JOIN public.riders_women rw ON (r.gender = 'female'::text OR r.gender IS NULL) AND rw.id = sr."globalRiderId"
     CROSS JOIN LATERAL ( SELECT COALESCE(r.gender, sr."riderGender",
                CASE
                    WHEN rm.id IS NOT NULL AND rw.id IS NULL THEN 'male'::text
                    WHEN rw.id IS NOT NULL AND rm.id IS NULL THEN 'female'::text
                    ELSE NULL::text
                END) AS gender) resolved
     LEFT JOIN LATERAL ( SELECT h."firstName", h."lastName"
           FROM public.rider_name_history h
          WHERE h."riderId" = sr."globalRiderId" AND h."riderGender" = resolved.gender AND pg_catalog.to_char(h."validTo", 'YYYY-MM-DD') >= r."startDate"
          ORDER BY h."validTo"
         LIMIT 1) hist ON true;

-- Cambio de nombre con vigencia: guarda el nombre actual en el historial hasta
-- p_valid_to, pone el nuevo en la ficha y conserva el anterior para el matching
-- (otherNames y rider_identity_aliases). No toca startlist_riders.
CREATE OR REPLACE FUNCTION public.admin_change_rider_name(
  p_gender text,
  p_rider_id text,
  p_first_name text,
  p_last_name text,
  p_valid_to date,
  p_reason text DEFAULT NULL,
  p_source_url text DEFAULT NULL
) RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_first text := pg_catalog.btrim(COALESCE(p_first_name, ''));
  v_last text := pg_catalog.btrim(COALESCE(p_last_name, ''));
  v_found boolean;
  v_old_first text;
  v_old_last text;
  v_old_other text;
  v_old_key text;
  v_ultimo date;
  v_completo text;
  v_otros text;
BEGIN
  IF NOT COALESCE(private.is_admin(), false) THEN
    RAISE EXCEPTION 'Se requieren permisos de administración' USING ERRCODE = '42501';
  END IF;
  IF p_gender NOT IN ('male', 'female') THEN
    RAISE EXCEPTION 'Género inválido; usar male o female' USING ERRCODE = '22023';
  END IF;
  IF p_rider_id IS NULL OR p_valid_to IS NULL OR v_first = '' OR v_last = '' THEN
    RAISE EXCEPTION 'Se requieren corredor, nombre nuevo y último día del nombre anterior' USING ERRCODE = '22023';
  END IF;

  IF p_gender = 'male' THEN
    SELECT true, r."firstName", r."lastName", r."otherNames", r."identityKey"
      INTO v_found, v_old_first, v_old_last, v_old_other, v_old_key
      FROM public.riders_men r WHERE r.id = p_rider_id FOR UPDATE;
  ELSE
    SELECT true, r."firstName", r."lastName", r."otherNames", r."identityKey"
      INTO v_found, v_old_first, v_old_last, v_old_other, v_old_key
      FROM public.riders_women r WHERE r.id = p_rider_id FOR UPDATE;
  END IF;
  IF v_found IS NULL THEN
    RAISE EXCEPTION 'Corredor % no encontrado', p_rider_id USING ERRCODE = '22023';
  END IF;
  IF v_first = v_old_first AND v_last = v_old_last THEN
    RAISE EXCEPTION 'El nombre nuevo coincide con el actual' USING ERRCODE = '22023';
  END IF;

  SELECT pg_catalog.max(h."validTo") INTO v_ultimo
    FROM public.rider_name_history h
   WHERE h."riderGender" = p_gender AND h."riderId" = p_rider_id;
  IF v_ultimo IS NOT NULL AND p_valid_to <= v_ultimo THEN
    RAISE EXCEPTION 'La fecha debe ser posterior al último cambio registrado (%)', v_ultimo USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.rider_name_history ("riderId", "riderGender", "firstName", "lastName", "validTo", reason, "sourceUrl")
  VALUES (p_rider_id, p_gender, v_old_first, v_old_last, p_valid_to,
          NULLIF(pg_catalog.btrim(p_reason), ''), NULLIF(pg_catalog.btrim(p_source_url), ''));

  -- El nombre completo anterior pasa a otherNames (separado por comas) si no estaba.
  v_completo := pg_catalog.btrim(v_old_first || ' ' || v_old_last);
  IF v_old_other IS NULL OR pg_catalog.btrim(v_old_other) = '' THEN
    v_otros := v_completo;
  ELSIF EXISTS (
    SELECT 1 FROM pg_catalog.unnest(pg_catalog.string_to_array(v_old_other, ',')) AS a
    WHERE pg_catalog.lower(pg_catalog.btrim(a)) = pg_catalog.lower(v_completo)
  ) THEN
    v_otros := v_old_other;
  ELSE
    v_otros := v_old_other || ', ' || v_completo;
  END IF;

  IF p_gender = 'male' THEN
    UPDATE public.riders_men
       SET "firstName" = v_first, "lastName" = v_last, "otherNames" = v_otros, "updatedAt" = pg_catalog.now()
     WHERE id = p_rider_id;
  ELSE
    UPDATE public.riders_women
       SET "firstName" = v_first, "lastName" = v_last, "otherNames" = v_otros, "updatedAt" = pg_catalog.now()
     WHERE id = p_rider_id;
  END IF;

  -- La clave de identidad cambia con el nombre (triggers set_identity_key_*): se
  -- conserva la anterior como alias del mismo corredor.
  IF v_old_key IS NOT NULL THEN
    INSERT INTO public.rider_identity_aliases ("aliasKey", gender, "riderId", note)
    VALUES (v_old_key, p_gender, p_rider_id, 'nombre anterior hasta ' || p_valid_to::text)
    ON CONFLICT ("aliasKey", gender) DO NOTHING;
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'riderId', p_rider_id, 'gender', p_gender,
    'previousName', v_completo, 'newName', pg_catalog.btrim(v_first || ' ' || v_last),
    'validTo', p_valid_to, 'previousIdentityKey', v_old_key
  );
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.admin_change_rider_name(text, text, text, text, date, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_change_rider_name(text, text, text, text, date, text, text) TO authenticated, cc_agent;

-- Cambio de slug: el historial acompaña al corredor.
CREATE OR REPLACE FUNCTION public.admin_rename_rider(p_gender text, p_old_id text, p_new_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_tabla text;
  v_otra text;
  v_fila boolean;
  v_ocupado boolean;
  v_compartido boolean;
  v_startlist integer;
  v_resultados integer;
  v_afiliaciones integer;
  v_afiliaciones_id integer;
  v_transferencias integer;
  v_alias integer;
  v_perfiles_uci integer;
  v_cambios_uci integer;
  v_historial integer;
BEGIN
  IF NOT COALESCE(private.is_admin(), false) THEN
    RAISE EXCEPTION 'Se requieren permisos de administración' USING ERRCODE = '42501';
  END IF;
  IF p_gender NOT IN ('male', 'female') THEN
    RAISE EXCEPTION 'Género inválido; usar male o female' USING ERRCODE = '22023';
  END IF;
  IF p_old_id IS NULL OR p_new_id IS NULL THEN
    RAISE EXCEPTION 'Identificadores obligatorios' USING ERRCODE = '22023';
  END IF;
  IF p_new_id = p_old_id THEN
    RAISE EXCEPTION 'El slug nuevo coincide con el actual' USING ERRCODE = '22023';
  END IF;
  IF p_new_id !~ '^[a-z0-9-]{1,80}$' THEN
    RAISE EXCEPTION 'Slug nuevo inválido' USING ERRCODE = '22023';
  END IF;

  v_tabla := CASE p_gender WHEN 'male' THEN 'riders_men' ELSE 'riders_women' END;
  v_otra := CASE p_gender WHEN 'male' THEN 'riders_women' ELSE 'riders_men' END;
  EXECUTE pg_catalog.format('SELECT true FROM public.%I WHERE id = $1 FOR UPDATE', v_tabla)
    INTO v_fila USING p_old_id;
  IF v_fila IS NULL THEN
    RAISE EXCEPTION 'Corredor % no encontrado', p_old_id USING ERRCODE = '22023';
  END IF;
  EXECUTE pg_catalog.format('SELECT EXISTS (SELECT 1 FROM public.%I WHERE id = $1)', v_tabla)
    INTO v_ocupado USING p_new_id;
  IF v_ocupado THEN
    RAISE EXCEPTION 'El slug % ya está ocupado', p_new_id USING ERRCODE = '22023';
  END IF;
  EXECUTE pg_catalog.format('SELECT EXISTS (SELECT 1 FROM public.%I WHERE id = $1)', v_otra)
    INTO v_compartido USING p_old_id;

  IF v_compartido AND (
    EXISTS (SELECT 1 FROM public.startlist_riders s LEFT JOIN public.races r ON r.id = s."raceId"
            WHERE s."globalRiderId" = p_old_id AND COALESCE(s."riderGender", r.gender) IS NULL)
    OR EXISTS (SELECT 1 FROM public.race_uci_results x LEFT JOIN public.races r ON r.id = x."raceId"
               WHERE x."globalRiderId" = p_old_id AND r.gender IS NULL)
  ) THEN
    RAISE EXCEPTION 'El id % existe en ambos géneros y hay referencias sin género determinable', p_old_id
      USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.rider_team_affiliations a
    WHERE a."riderId" = p_old_id AND a."riderGender" = p_gender
      AND pg_catalog.left(a.id, pg_catalog.length(p_old_id) + 2) = p_old_id || '__'
      AND EXISTS (SELECT 1 FROM public.rider_team_affiliations o
                  WHERE o.id = p_new_id || pg_catalog.substr(a.id, pg_catalog.length(p_old_id) + 1))
  ) THEN
    RAISE EXCEPTION 'Ya existe una afiliación con el identificador regenerado para %', p_new_id
      USING ERRCODE = '23505';
  END IF;

  EXECUTE pg_catalog.format('UPDATE public.%I SET id = $1 WHERE id = $2', v_tabla)
    USING p_new_id, p_old_id;

  UPDATE public.rider_team_affiliations SET "riderId" = p_new_id
  WHERE "riderId" = p_old_id AND "riderGender" = p_gender;
  GET DIAGNOSTICS v_afiliaciones = ROW_COUNT;

  UPDATE public.rider_team_affiliations
  SET id = p_new_id || pg_catalog.substr(id, pg_catalog.length(p_old_id) + 1)
  WHERE "riderId" = p_new_id AND "riderGender" = p_gender
    AND pg_catalog.left(id, pg_catalog.length(p_old_id) + 2) = p_old_id || '__';
  GET DIAGNOSTICS v_afiliaciones_id = ROW_COUNT;

  UPDATE public.startlist_riders s SET "globalRiderId" = p_new_id
  WHERE s."globalRiderId" = p_old_id
    AND (NOT v_compartido OR COALESCE(s."riderGender",
      (SELECT r.gender FROM public.races r WHERE r.id = s."raceId")) = p_gender);
  GET DIAGNOSTICS v_startlist = ROW_COUNT;

  UPDATE public.race_uci_results x SET "globalRiderId" = p_new_id
  WHERE x."globalRiderId" = p_old_id
    AND (NOT v_compartido OR (SELECT r.gender FROM public.races r WHERE r.id = x."raceId") = p_gender);
  GET DIAGNOSTICS v_resultados = ROW_COUNT;

  UPDATE public.rider_transfers SET "riderId" = p_new_id
  WHERE "riderId" = p_old_id AND "riderGender" = p_gender;
  GET DIAGNOSTICS v_transferencias = ROW_COUNT;

  UPDATE public.rider_identity_aliases SET "riderId" = p_new_id
  WHERE "riderId" = p_old_id AND gender = p_gender;
  GET DIAGNOSTICS v_alias = ROW_COUNT;

  UPDATE public.rider_name_history SET "riderId" = p_new_id
  WHERE "riderId" = p_old_id AND "riderGender" = p_gender;
  GET DIAGNOSTICS v_historial = ROW_COUNT;

  UPDATE private.rider_uci_profile_aliases SET "riderId" = p_new_id, "updatedAt" = pg_catalog.now()
  WHERE "riderId" = p_old_id AND "riderGender" = p_gender;
  GET DIAGNOSTICS v_perfiles_uci = ROW_COUNT;

  UPDATE private.uci_catalog_changes SET rider_id = p_new_id
  WHERE rider_id = p_old_id AND gender = p_gender;
  GET DIAGNOSTICS v_cambios_uci = ROW_COUNT;

  EXECUTE pg_catalog.format('UPDATE public.%I SET "updatedAt" = pg_catalog.now() WHERE id = $1', v_tabla)
    USING p_new_id;

  RETURN pg_catalog.jsonb_build_object(
    'table', v_tabla, 'oldId', p_old_id, 'newId', p_new_id, 'riders', 1,
    'sharedAcrossGenders', v_compartido,
    'startlist_riders', v_startlist, 'race_uci_results', v_resultados,
    'rider_team_affiliations', v_afiliaciones, 'rider_team_affiliations_ids', v_afiliaciones_id,
    'rider_transfers', v_transferencias, 'rider_identity_aliases', v_alias,
    'rider_name_history', v_historial,
    'rider_uci_profile_aliases', v_perfiles_uci, 'uci_catalog_changes', v_cambios_uci
  );
END;
$function$;
