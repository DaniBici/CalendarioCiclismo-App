-- race_uci_results.id usa una secuencia. El rol del watcher necesita avanzar
-- únicamente esa secuencia para insertar las filas normalizadas de resultados.
GRANT USAGE, SELECT ON SEQUENCE public.race_uci_results_id_seq
TO cc_results_worker;
