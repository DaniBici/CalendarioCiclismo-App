-- Retirar privilegios heredados que no usa el selector. RLS no limita TRUNCATE.
REVOKE TRUNCATE, REFERENCES, TRIGGER ON public.race_featured_overrides
  FROM anon, authenticated, service_role;
