-- Permite al worker crear el enlace CX que ya valida cx-live-linker.
-- El GRANT de columnas existe desde 20260913160100; faltaba la policy RLS.
CREATE POLICY cx_worker_insert ON public.cx_race_uci_links
  FOR INSERT TO cc_results_worker
  WITH CHECK (true);

NOTIFY pgrst, 'reload schema';
