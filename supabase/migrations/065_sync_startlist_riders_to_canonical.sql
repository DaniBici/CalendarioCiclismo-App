-- Sincroniza startlist_riders.firstName/lastName/countryCode con la BD canónica
-- (riders_men / riders_women) cuando hay globalRiderId. Cuando se detecta
-- diferencia con comparación estricta (=), se sobrescribe el snapshot en
-- startlist_riders y se propaga el cambio a start_order_entries.riderName /
-- countryCode (por dorsal + raceDayId).
--
-- Esta función repara la deriva acumulada: startlist_riders importadas antes
-- de la corrección del flujo de save quedaron con nombres más largos que la
-- ficha canónica (p.ej. "Juan Sebastián Molano" en startlist vs "Sebastián
-- Molano" en riders_men) porque el sync sólo se aplicaba a auto-matches con
-- score >= 0.9 y nunca a riders con globalRiderId ya set.
--
-- Reglas:
--   1. Sólo afecta filas con globalRiderId NOT NULL.
--   2. firstName/lastName: igualdad estricta — si difieren, se sobrescribe.
--   3. countryCode: si startlist tiene NULL y la BD tiene nationality, se copia.
--      Si startlist tiene un valor (p.ej. selección nacional), se respeta.
--   4. Propaga el cambio a start_order_entries vía (dorsal, raceDayId).
--
-- Parámetro p_race_id: si se pasa, limita el sync a esa carrera. Si es NULL,
-- procesa todas las startlists.
--
-- Retorna conteos para que el caller pueda mostrar feedback.

CREATE OR REPLACE FUNCTION public.sync_startlist_riders_to_canonical(p_race_id text DEFAULT NULL)
RETURNS TABLE (
  updated_startlist_riders integer,
  updated_start_order_entries integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sr_updated  integer := 0;
  v_soe_updated integer := 0;
BEGIN
  -- 1) startlist_riders ← riders_men/women donde hay link y diverge algo.
  WITH male_diffs AS (
    SELECT sr.id,
           rm."firstName"   AS new_first,
           rm."lastName"    AS new_last,
           CASE WHEN sr."countryCode" IS NULL AND rm.nationality IS NOT NULL
                THEN rm.nationality ELSE sr."countryCode" END AS new_country
    FROM startlist_riders sr
    JOIN races r ON r.id = sr."raceId" AND r.gender = 'male'
    JOIN riders_men rm ON rm.id = sr."globalRiderId"
    WHERE sr."globalRiderId" IS NOT NULL
      AND (p_race_id IS NULL OR sr."raceId" = p_race_id)
      AND (
            sr."firstName" <> rm."firstName"
         OR sr."lastName"  <> rm."lastName"
         OR (sr."countryCode" IS NULL AND rm.nationality IS NOT NULL)
      )
  ),
  female_diffs AS (
    SELECT sr.id,
           rw."firstName" AS new_first,
           rw."lastName"  AS new_last,
           CASE WHEN sr."countryCode" IS NULL AND rw.nationality IS NOT NULL
                THEN rw.nationality ELSE sr."countryCode" END AS new_country
    FROM startlist_riders sr
    JOIN races r ON r.id = sr."raceId" AND r.gender = 'female'
    JOIN riders_women rw ON rw.id = sr."globalRiderId"
    WHERE sr."globalRiderId" IS NOT NULL
      AND (p_race_id IS NULL OR sr."raceId" = p_race_id)
      AND (
            sr."firstName" <> rw."firstName"
         OR sr."lastName"  <> rw."lastName"
         OR (sr."countryCode" IS NULL AND rw.nationality IS NOT NULL)
      )
  ),
  all_diffs AS (SELECT * FROM male_diffs UNION ALL SELECT * FROM female_diffs),
  upd_sr AS (
    UPDATE startlist_riders sr
       SET "firstName"   = d.new_first,
           "lastName"    = d.new_last,
           "countryCode" = d.new_country
      FROM all_diffs d
     WHERE sr.id = d.id
    RETURNING sr.id
  )
  SELECT count(*) INTO v_sr_updated FROM upd_sr;

  -- 2) Propagar a start_order_entries por (raceDayId, dorsal). Releemos la
  --    vista resuelta para que riderName quede con la versión canónica y el
  --    countryCode coincida (mismo criterio: startlist override gana si lo
  --    hay; si no, nacionalidad BD). Sólo tocamos filas que realmente cambian.
  WITH desired AS (
    SELECT
      soe.id,
      v."firstName" || ' ' || v."lastName" AS new_name,
      v."countryCode" AS new_country,
      v.id AS new_rider_id
    FROM start_order_entries soe
    JOIN race_days rd  ON rd.id = soe."raceDayId"
    JOIN startlist_riders_resolved v
      ON v."raceId" = rd."raceId" AND v.dorsal = soe.dorsal
    WHERE p_race_id IS NULL OR rd."raceId" = p_race_id
  ),
  upd_soe AS (
    UPDATE start_order_entries soe
       SET "riderName"   = trim(d.new_name),
           "countryCode" = d.new_country,
           "riderId"     = d.new_rider_id
      FROM desired d
     WHERE soe.id = d.id
       AND (
              soe."riderName"   IS DISTINCT FROM trim(d.new_name)
           OR soe."countryCode" IS DISTINCT FROM d.new_country
           OR soe."riderId"     IS DISTINCT FROM d.new_rider_id
       )
    RETURNING soe.id
  )
  SELECT count(*) INTO v_soe_updated FROM upd_soe;

  updated_startlist_riders    := v_sr_updated;
  updated_start_order_entries := v_soe_updated;
  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.sync_startlist_riders_to_canonical(text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.sync_startlist_riders_to_canonical(text) TO authenticated, service_role;
