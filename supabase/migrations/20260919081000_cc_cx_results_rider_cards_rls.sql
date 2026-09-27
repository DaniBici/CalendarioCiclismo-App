-- Permite a cx_ingest_results crear fichas CX nuevas cuando la resolución
-- verificada no encuentra una ficha compatible.
-- Los GRANT de INSERT existen desde 20260913164000; faltaban las policies RLS.
CREATE POLICY cx_worker_insert ON public.cx_riders_men
  FOR INSERT TO cc_results_worker
  WITH CHECK (true);

CREATE POLICY cx_worker_insert ON public.cx_riders_women
  FOR INSERT TO cc_results_worker
  WITH CHECK (true);

NOTIFY pgrst, 'reload schema';
