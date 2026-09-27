-- Los IDs sintéticos de los resultados manuales no son destinos de DataRide.
ALTER TABLE public.race_uci_links
  ADD CONSTRAINT race_uci_links_real_dataride_ids_check
  CHECK (source <> 'uci' OR ("competitionId" > 0 AND COALESCE("uciRaceId", 0) >= 0));
