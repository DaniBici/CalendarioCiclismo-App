-- Retirada de la envoltura de inscritos de Tissot del VPS. El sincronizador
-- tissot-startlists-sync.mjs salió del runner el 2026-09-25 y se eliminó del
-- repositorio el 2026-11-01; la función no tiene llamadores. Las listas de
-- Tissot se importan a mano con prepare_startlist_import/apply_startlist_import.
-- private.assert_startlist_import_admin y los SELECT de cc_results_worker no se
-- tocan. La captura de RESULTADOS de race_uci_links.source='tissot' no cambia.

DROP FUNCTION IF EXISTS public.vps_import_tissot_startlist(jsonb);
