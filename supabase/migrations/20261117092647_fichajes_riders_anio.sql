-- Mercado de fichajes: la web lee solo el año de nacimiento, nunca la fecha completa.
-- security_invoker: la vista aplica los permisos y las políticas RLS de la tabla base.
CREATE VIEW public.fichajes_riders_men WITH (security_invoker = true) AS
  SELECT id, "firstName", "lastName", nationality, "contractUntil",
         EXTRACT(YEAR FROM "birthDate")::int AS "birthYear"
  FROM public.riders_men;

CREATE VIEW public.fichajes_riders_women WITH (security_invoker = true) AS
  SELECT id, "firstName", "lastName", nationality, "contractUntil",
         EXTRACT(YEAR FROM "birthDate")::int AS "birthYear"
  FROM public.riders_women;

GRANT SELECT ON public.fichajes_riders_men, public.fichajes_riders_women TO anon, authenticated;

COMMENT ON VIEW public.fichajes_riders_men IS 'Corredores masculinos para el mercado de fichajes: solo el año de nacimiento.';
COMMENT ON VIEW public.fichajes_riders_women IS 'Corredoras para el mercado de fichajes: solo el año de nacimiento.';
