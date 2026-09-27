-- El enlazador live CX inserta enlaces nuevos con la conexión del worker.
-- GRANT mínimo: solo las columnas que escribe el INSERT.
GRANT INSERT ("raceId","competitionId","seasonId","uciRaceId","syncEnabled","syncStartOffsetMinutes","syncStopOffsetMinutes")
  ON TABLE public.cx_race_uci_links TO cc_results_worker;

NOTIFY pgrst, 'reload schema';
