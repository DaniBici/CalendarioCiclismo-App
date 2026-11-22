-- Columnas de corredor fuera del acceso anónimo (aprobado por Dani).
-- riders_men/women: anon deja de leer identityKey, searchName, createdAt, updatedAt, otherNames y uciProfileId.
-- cx_riders_men/women: anon deja de leer birthDate (fecha de nacimiento completa) y uciProfileId.
-- La licencia UCI (uciLicenseId) no cambia. La vista startlist_riders_resolved no referencia estas columnas.
REVOKE SELECT ON public.riders_men FROM anon;
GRANT SELECT ("id", "firstName", "lastName", "nationality", "currentTeamId", "contractUntil", "source", "verified", "uciLicenseId", "historicalCatalogOnly", "birthYear") ON public.riders_men TO anon;
REVOKE SELECT ON public.riders_women FROM anon;
GRANT SELECT ("id", "firstName", "lastName", "nationality", "currentTeamId", "contractUntil", "source", "verified", "uciLicenseId", "historicalCatalogOnly", "birthYear") ON public.riders_women TO anon;
REVOKE SELECT ON public.cx_riders_men FROM anon;
GRANT SELECT ("id", "firstName", "lastName", "nationality", "currentTeamId", "source", "verified", "uciLicenseId", "createdAt", "updatedAt", "birthDatePrecision", "searchName", "currentTeamSince", "otherNames") ON public.cx_riders_men TO anon;
REVOKE SELECT ON public.cx_riders_women FROM anon;
GRANT SELECT ("id", "firstName", "lastName", "nationality", "currentTeamId", "source", "verified", "uciLicenseId", "createdAt", "updatedAt", "birthDatePrecision", "searchName", "currentTeamSince", "otherNames") ON public.cx_riders_women TO anon;
