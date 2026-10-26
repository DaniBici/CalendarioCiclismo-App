-- cx_replace_results (SECURITY INVOKER) invoca private.order_cx_irm_results tras insertar
-- las filas. La migración cx_irm_order_function revocó la función a PUBLIC sin concederla
-- a los roles que ejecutan cx_replace_results y cx_ingest_results: toda carga de
-- resultados CX (worker, panel y agentes) fallaba con «permission denied». La función
-- sigue siendo SECURITY INVOKER y queda sujeta a los privilegios de cx_results del llamante.
GRANT EXECUTE ON FUNCTION private.order_cx_irm_results(text, text) TO authenticated, cc_results_worker, cc_agent;
