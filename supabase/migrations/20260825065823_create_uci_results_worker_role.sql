-- Rol de acceso limitado para el sincronizador de resultados alojado en el VPS.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'cc_results_worker') THEN
    CREATE ROLE cc_results_worker
      NOLOGIN
      NOSUPERUSER
      NOCREATEDB
      NOCREATEROLE
      NOREPLICATION
      NOINHERIT;
  END IF;
END
$$;

GRANT CONNECT ON DATABASE postgres TO cc_results_worker;
GRANT USAGE ON SCHEMA public TO cc_results_worker;

GRANT SELECT ON TABLE
  public.races,
  public.race_days,
  public.race_uci_links,
  public.race_uci_stages,
  public.race_uci_results,
  public.startlist_teams,
  public.startlist_riders,
  public.startlist_riders_resolved,
  public.teams,
  public.riders_men,
  public.riders_women,
  public.rider_identity_aliases
TO cc_results_worker;

GRANT INSERT, UPDATE, DELETE ON TABLE
  public.race_uci_links,
  public.race_uci_stages,
  public.race_uci_results,
  public.startlist_teams,
  public.startlist_riders,
  public.riders_men,
  public.riders_women
TO cc_results_worker;

GRANT UPDATE ("resultsLastAutoSyncAt", "resultsAutoSyncQueuedAt")
  ON public.race_days TO cc_results_worker;
GRANT UPDATE ("enrichedStartlist")
  ON public.races TO cc_results_worker;

GRANT EXECUTE ON FUNCTION public.fold_name(text) TO cc_results_worker;
GRANT EXECUTE ON FUNCTION public.fold_team_name(text) TO cc_results_worker;
GRANT EXECUTE ON FUNCTION public.compute_identity_key(text, text) TO cc_results_worker;
GRANT EXECUTE ON FUNCTION public.resolve_uci_results(text) TO cc_results_worker;
GRANT EXECUTE ON FUNCTION public.resolve_uci_results_by_name(text, text, jsonb) TO cc_results_worker;
GRANT EXECUTE ON FUNCTION public.resolve_uci_startlist(text, text, jsonb) TO cc_results_worker;

-- El rol se conecta directamente a Postgres y, por tanto, está sujeto a RLS.
-- Las políticas se limitan a las tablas que utiliza el cron y no conceden acceso
-- a ninguna tabla administrativa, de usuarios, pagos, notificaciones o contenido.
CREATE POLICY cc_results_worker_access ON public.race_uci_links
  FOR ALL TO cc_results_worker USING (true) WITH CHECK (true);
CREATE POLICY cc_results_worker_access ON public.race_uci_stages
  FOR ALL TO cc_results_worker USING (true) WITH CHECK (true);
CREATE POLICY cc_results_worker_access ON public.race_uci_results
  FOR ALL TO cc_results_worker USING (true) WITH CHECK (true);
CREATE POLICY cc_results_worker_access ON public.startlist_teams
  FOR ALL TO cc_results_worker USING (true) WITH CHECK (true);
CREATE POLICY cc_results_worker_access ON public.startlist_riders
  FOR ALL TO cc_results_worker USING (true) WITH CHECK (true);
CREATE POLICY cc_results_worker_access ON public.riders_men
  FOR ALL TO cc_results_worker USING (true) WITH CHECK (true);
CREATE POLICY cc_results_worker_access ON public.riders_women
  FOR ALL TO cc_results_worker USING (true) WITH CHECK (true);

CREATE POLICY cc_results_worker_read ON public.race_days
  FOR SELECT TO cc_results_worker USING (true);
CREATE POLICY cc_results_worker_update ON public.race_days
  FOR UPDATE TO cc_results_worker USING (true) WITH CHECK (true);
CREATE POLICY cc_results_worker_read ON public.races
  FOR SELECT TO cc_results_worker USING (true);
CREATE POLICY cc_results_worker_update ON public.races
  FOR UPDATE TO cc_results_worker USING (true) WITH CHECK (true);
CREATE POLICY cc_results_worker_read ON public.teams
  FOR SELECT TO cc_results_worker USING (true);
CREATE POLICY cc_results_worker_read ON public.rider_identity_aliases
  FOR SELECT TO cc_results_worker USING (true);
