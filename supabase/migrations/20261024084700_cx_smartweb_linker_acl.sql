-- El enlazador smartweb (cx-smartweb-linker.mjs, runner CX como cc_results_worker)
-- crea enlaces provider='smartweb' con el índice de clasificaciones de la prueba
-- ("sourceUrl") y la correspondencia rótulo → categoría ("categoryKeys"). El
-- worker ya inserta raceId, provider, eventId, ctx y la ventana (ACN); se añaden
-- solo esas dos columnas. Las restricciones de cx_race_timing_links validan el
-- formato de ambas.
GRANT INSERT ("sourceUrl", "categoryKeys") ON TABLE public.cx_race_timing_links TO cc_results_worker;
