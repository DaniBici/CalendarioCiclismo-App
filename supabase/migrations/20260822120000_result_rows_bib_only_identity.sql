-- Las filas individuales con dorsal se resuelven contra startlist_riders.
-- riderDisplay deja de almacenar una segunda identidad de la fuente; permanece
-- utilizable solo como fallback de equipos y de documentos históricos sin dorsal.
ALTER TABLE public.race_uci_results
  ALTER COLUMN "riderDisplay" DROP NOT NULL;

COMMENT ON COLUMN public.race_uci_results."riderDisplay" IS
  'Fallback exclusivamente para eventos por equipos o filas históricas sin dorsal. Las filas individuales con bib deben guardar NULL y resolverse por startlist_riders.';
