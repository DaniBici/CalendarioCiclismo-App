-- Fecha de nacimiento fuera del acceso anónimo (decisión de Dani: año de nacimiento en la web).
-- 1) birthYear: columna calculada a partir de birthDate. Solo lectura; el año es lo único público.
ALTER TABLE public.riders_men ADD COLUMN "birthYear" smallint GENERATED ALWAYS AS (EXTRACT(YEAR FROM "birthDate")::smallint) STORED;
ALTER TABLE public.riders_women ADD COLUMN "birthYear" smallint GENERATED ALWAYS AS (EXTRACT(YEAR FROM "birthDate")::smallint) STORED;

-- 2) Vistas de fichajes creadas antes para el año: ya no hacen falta.
DROP VIEW public.fichajes_riders_men;
DROP VIEW public.fichajes_riders_women;

-- 3) startlist_riders_resolved sigue existiendo (apps y web la leen) con la columna birthDate siempre nula.
--    El panel de administración, autenticado, lee la fecha de las tablas riders_men/women.
CREATE OR REPLACE VIEW public.startlist_riders_resolved WITH (security_invoker = true) AS
SELECT sr.id,
    sr."teamId",
    sr."raceId",
    sr.dorsal,
    COALESCE(NULLIF(
        CASE
            WHEN resolved.gender = 'male'::text THEN rm."firstName"
            WHEN resolved.gender = 'female'::text THEN rw."firstName"
            ELSE NULL::text
        END, ''::text), sr."firstName") AS "firstName",
    COALESCE(NULLIF(
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
   FROM startlist_riders sr
     JOIN races r ON r.id = sr."raceId"
     LEFT JOIN riders_men rm ON (r.gender = 'male'::text OR r.gender IS NULL) AND rm.id = sr."globalRiderId"
     LEFT JOIN riders_women rw ON (r.gender = 'female'::text OR r.gender IS NULL) AND rw.id = sr."globalRiderId"
     CROSS JOIN LATERAL ( SELECT COALESCE(r.gender, sr."riderGender",
                CASE
                    WHEN rm.id IS NOT NULL AND rw.id IS NULL THEN 'male'::text
                    WHEN rw.id IS NOT NULL AND rm.id IS NULL THEN 'female'::text
                    ELSE NULL::text
                END) AS gender) resolved;

-- 4) anon deja de leer birthDate de las tablas de corredores; conserva el resto de columnas y birthYear.
REVOKE SELECT ON public.riders_men FROM anon;
GRANT SELECT ("id", "firstName", "lastName", "otherNames", "nationality", "currentTeamId", "createdAt", "updatedAt", "source", "verified", "identityKey", "contractUntil", "uciProfileId", "uciLicenseId", "historicalCatalogOnly", "searchName", "birthYear") ON public.riders_men TO anon;
REVOKE SELECT ON public.riders_women FROM anon;
GRANT SELECT ("id", "firstName", "lastName", "otherNames", "nationality", "currentTeamId", "createdAt", "updatedAt", "source", "verified", "identityKey", "contractUntil", "uciProfileId", "uciLicenseId", "historicalCatalogOnly", "searchName", "birthYear") ON public.riders_women TO anon;
