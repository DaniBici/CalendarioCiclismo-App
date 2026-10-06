-- Recuperada el 2026-09-28 de supabase_migrations.schema_migrations.statements
-- (versión 20260625043119, nombre cn_flag_prefer_rider_nationality). Texto aplicado en producción, sin cambios.

CREATE OR REPLACE VIEW startlist_riders_resolved AS
 SELECT sr.id,
    sr."teamId",
    sr."raceId",
    sr.dorsal,
    COALESCE(NULLIF(
        CASE
            WHEN r.gender = 'male'::text THEN rm."firstName"
            WHEN r.gender = 'female'::text THEN rw."firstName"
            ELSE NULL::text
        END, ''::text), sr."firstName") AS "firstName",
    COALESCE(NULLIF(
        CASE
            WHEN r.gender = 'male'::text THEN rm."lastName"
            WHEN r.gender = 'female'::text THEN rw."lastName"
            ELSE NULL::text
        END, ''::text), sr."lastName") AS "lastName",
    sr."createdAt",
    CASE
        WHEN r."uciCategory" = 'CN'::text THEN
            COALESCE(NULLIF(
                CASE
                    WHEN r.gender = 'male'::text THEN rm.nationality
                    WHEN r.gender = 'female'::text THEN rw.nationality
                    ELSE NULL::text
                END, ''::text), NULLIF(sr."countryCode", ''::text))
        ELSE
            COALESCE(NULLIF(sr."countryCode", ''::text),
                CASE
                    WHEN r.gender = 'male'::text THEN rm.nationality
                    WHEN r.gender = 'female'::text THEN rw.nationality
                    ELSE NULL::text
                END)
    END AS "countryCode",
    sr."globalRiderId",
    COALESCE(
        CASE
            WHEN r.gender = 'male'::text THEN rm.verified
            WHEN r.gender = 'female'::text THEN rw.verified
            ELSE NULL::boolean
        END, false) AS verified,
    COALESCE(
        CASE
            WHEN r.gender = 'male'::text THEN rm.source
            WHEN r.gender = 'female'::text THEN rw.source
            ELSE NULL::text
        END, 'snapshot_only'::text) AS source,
        CASE
            WHEN r.gender = 'male'::text THEN rm."birthDate"
            WHEN r.gender = 'female'::text THEN rw."birthDate"
            ELSE NULL::date
        END AS "birthDate",
        CASE
            WHEN r.gender = 'male'::text THEN rm."currentTeamId"
            WHEN r.gender = 'female'::text THEN rw."currentTeamId"
            ELSE NULL::text
        END AS "currentTeamId",
    r.gender AS race_gender
   FROM startlist_riders sr
     JOIN races r ON r.id = sr."raceId"
     LEFT JOIN riders_men rm ON r.gender = 'male'::text AND rm.id = sr."globalRiderId"
     LEFT JOIN riders_women rw ON r.gender = 'female'::text AND rw.id = sr."globalRiderId";
