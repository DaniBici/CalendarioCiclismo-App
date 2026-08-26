-- El mismo usuario de sistema ejecuta un servicio separado para el ránking de
-- equipos. Se amplía el rol PostgreSQL solo con los objetos que necesita.

GRANT SELECT ON TABLE public.team_seasons TO cc_results_worker;
GRANT SELECT, INSERT, DELETE ON TABLE public.uci_team_rankings TO cc_results_worker;

CREATE POLICY cc_results_worker_read ON public.team_seasons
  FOR SELECT TO cc_results_worker USING (true);
CREATE POLICY cc_results_worker_access ON public.uci_team_rankings
  FOR ALL TO cc_results_worker USING (true) WITH CHECK (true);
