-- La UCI publica las categorías de una competición CX de forma progresiva.
-- La cadencia pertenece a cada manga: un fetch temprano no retrasa las demás.
-- El estado operativo queda fuera del catálogo editorial para no invalidar las
-- generales cada vez que el worker consulta DataRide.
CREATE TABLE private.cx_results_fetch_state (
  "raceId" text NOT NULL,
  category text NOT NULL,
  "lastFetchAt" timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("raceId",category),
  FOREIGN KEY ("raceId",category)
    REFERENCES public.cx_race_categories("raceId",category) ON DELETE CASCADE
);

COMMENT ON TABLE private.cx_results_fetch_state IS
  'Cadencia operativa por categoría para la recogida progresiva de resultados CX.';
COMMENT ON COLUMN private.cx_results_fetch_state."lastFetchAt" IS
  'Última consulta a DataRide; no acredita publicación ni meta.';

ALTER TABLE public.cx_race_uci_links
  ALTER COLUMN "syncIntervalMinutes" SET DEFAULT 5;

UPDATE public.cx_race_uci_links
SET "syncIntervalMinutes"=5,"updatedAt"=now()
WHERE "syncIntervalMinutes"=30;

REVOKE ALL ON TABLE private.cx_results_fetch_state FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON TABLE private.cx_results_fetch_state TO cc_results_worker;

NOTIFY pgrst,'reload schema';
