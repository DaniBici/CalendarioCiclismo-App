-- Restaura SECURITY DEFINER en las RPC del pipeline de resultados UCI.
--
-- Las re-creaciones de 20260904062430_startlist_enrichment_default.sql
-- (resolve_uci_startlist) y 20260904064031_results_resolution_event_scope.sql
-- (resolve_uci_results) omitieron la cláusula; CREATE OR REPLACE FUNCTION la
-- resetea a SECURITY INVOKER, así que el rol limitado cc_results_worker pasó a
-- ejecutar el cuerpo con sus propios privilegios. La primera referencia a una
-- tabla sin GRANT (races dentro de resolve_uci_startlist) revierte el volcado
-- completo con `permission denied for table races` y el enlace queda 'pending'
-- sin reemplazar los resultados sintéticos previos.
--
-- Diseño original: 082_resolve_uci_results.sql y 084_resolve_uci_startlist.sql
-- (SECURITY DEFINER, owner postgres). ALTER FUNCTION conserva el cuerpo, el
-- proconfig (search_path="") y la ACL vigentes.

ALTER FUNCTION public.resolve_uci_results(text) SECURITY DEFINER;
ALTER FUNCTION public.resolve_uci_startlist(text, text, jsonb) SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.resolve_uci_results(text) TO cc_results_worker;
GRANT EXECUTE ON FUNCTION public.resolve_uci_startlist(text, text, jsonb) TO cc_results_worker;
