-- Aísla las identidades creadas exclusivamente para el catálogo histórico.
-- Los clientes publicados conservan exactamente el mismo conjunto de filas en
-- sus consultas sin filtro; las vistas por temporada siguen siendo públicas.
BEGIN;

ALTER TABLE public.teams
  ADD COLUMN IF NOT EXISTS "historicalCatalogOnly" boolean NOT NULL DEFAULT false;
ALTER TABLE public.riders_men
  ADD COLUMN IF NOT EXISTS "historicalCatalogOnly" boolean NOT NULL DEFAULT false;
ALTER TABLE public.riders_women
  ADD COLUMN IF NOT EXISTS "historicalCatalogOnly" boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION private.mark_historical_catalog_row() RETURNS trigger
LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
  IF TG_TABLE_NAME='teams' THEN
    NEW."historicalCatalogOnly":=COALESCE(current_setting('app.historical_catalog',true),'')='on';
  ELSE
    NEW."historicalCatalogOnly":=NEW.source='uci_historical';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS mark_historical_catalog_team ON public.teams;
CREATE TRIGGER mark_historical_catalog_team
  BEFORE INSERT ON public.teams
  FOR EACH ROW EXECUTE FUNCTION private.mark_historical_catalog_row();
DROP TRIGGER IF EXISTS mark_historical_catalog_rider_men ON public.riders_men;
CREATE TRIGGER mark_historical_catalog_rider_men
  BEFORE INSERT ON public.riders_men
  FOR EACH ROW EXECUTE FUNCTION private.mark_historical_catalog_row();
DROP TRIGGER IF EXISTS mark_historical_catalog_rider_women ON public.riders_women;
CREATE TRIGGER mark_historical_catalog_rider_women
  BEFORE INSERT ON public.riders_women
  FOR EACH ROW EXECUTE FUNCTION private.mark_historical_catalog_row();

DROP POLICY IF EXISTS public_read_teams ON public.teams;
CREATE POLICY public_read_teams ON public.teams FOR SELECT TO public
  USING (NOT "historicalCatalogOnly");
DROP POLICY IF EXISTS public_read_riders_men ON public.riders_men;
CREATE POLICY public_read_riders_men ON public.riders_men FOR SELECT TO public
  USING (NOT "historicalCatalogOnly");
DROP POLICY IF EXISTS public_read_riders_women ON public.riders_women;
CREATE POLICY public_read_riders_women ON public.riders_women FOR SELECT TO public
  USING (NOT "historicalCatalogOnly");

CREATE POLICY historical_catalog_admin_read_teams ON public.teams FOR SELECT TO authenticated
  USING ((SELECT private.is_admin()));
CREATE POLICY historical_catalog_admin_read_riders_men ON public.riders_men FOR SELECT TO authenticated
  USING ((SELECT private.is_admin()));
CREATE POLICY historical_catalog_admin_read_riders_women ON public.riders_women FOR SELECT TO authenticated
  USING ((SELECT private.is_admin()));

REVOKE ALL ON FUNCTION private.mark_historical_catalog_row() FROM PUBLIC,anon,authenticated,service_role;

COMMIT;
