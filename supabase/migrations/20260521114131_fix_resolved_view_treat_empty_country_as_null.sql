-- Recuperada el 2026-09-28 de supabase_migrations.schema_migrations.statements
-- (versión 20260521114131, nombre fix_resolved_view_treat_empty_country_as_null). Texto aplicado en producción, sin cambios.

-- Patch: tratar countryCode='' como NULL para que COALESCE caiga al fallback de BD.
CREATE OR REPLACE VIEW public.startlist_riders_resolved AS
SELECT
  sr.id,
  sr."teamId",
  sr."raceId",
  sr.dorsal,
  COALESCE(
    NULLIF(CASE WHEN r.gender = 'male' THEN rm."firstName"
                WHEN r.gender = 'female' THEN rw."firstName"
           END, ''),
    sr."firstName"
  ) AS "firstName",
  COALESCE(
    NULLIF(CASE WHEN r.gender = 'male' THEN rm."lastName"
                WHEN r.gender = 'female' THEN rw."lastName"
           END, ''),
    sr."lastName"
  ) AS "lastName",
  sr."createdAt",
  COALESCE(
    NULLIF(sr."countryCode", ''),
    CASE WHEN r.gender = 'male' THEN rm.nationality
         WHEN r.gender = 'female' THEN rw.nationality
    END
  ) AS "countryCode",
  sr."globalRiderId",
  COALESCE(
    CASE WHEN r.gender = 'male' THEN rm.verified
         WHEN r.gender = 'female' THEN rw.verified
    END,
    false
  ) AS verified,
  COALESCE(
    CASE WHEN r.gender = 'male' THEN rm.source
         WHEN r.gender = 'female' THEN rw.source
    END,
    'snapshot_only'
  ) AS source,
  CASE WHEN r.gender = 'male' THEN rm."birthDate"
       WHEN r.gender = 'female' THEN rw."birthDate"
  END AS "birthDate",
  CASE WHEN r.gender = 'male' THEN rm."currentTeamId"
       WHEN r.gender = 'female' THEN rw."currentTeamId"
  END AS "currentTeamId",
  r.gender AS race_gender
FROM public.startlist_riders sr
JOIN public.races r ON r.id = sr."raceId"
LEFT JOIN public.riders_men   rm ON r.gender = 'male'   AND rm.id = sr."globalRiderId"
LEFT JOIN public.riders_women rw ON r.gender = 'female' AND rw.id = sr."globalRiderId";

GRANT SELECT ON public.startlist_riders_resolved TO anon, authenticated;
