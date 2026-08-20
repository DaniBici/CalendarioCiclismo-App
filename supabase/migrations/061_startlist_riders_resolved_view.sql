-- Vista que resuelve los campos de startlist_riders desde la BD canónica de
-- riders cuando hay link (globalRiderId), y cae al snapshot del propio
-- startlist_riders cuando no.
--
-- Esto permite editar a Tadej Pogačar UNA vez en riders_men y verlo
-- propagado a todas las startlists donde aparezca, sin tocar 11k filas.
--
-- Shape compatible con startlist_riders + columnas extra: verified, source,
-- birthDate, currentTeamId, race_gender. Las apps que sigan leyendo la tabla
-- original no se ven afectadas.
--
-- COALESCE detalles:
-- - firstName/lastName: BD primero si hay link y no es '', si no snapshot.
-- - countryCode: el override de la startlist (selección nacional, mundial) GANA.
--   Si está NULL o '', se cae a la nacionalidad de BD.
-- - verified/source: NULL si no hay link → defaults a (false, 'snapshot_only').

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
