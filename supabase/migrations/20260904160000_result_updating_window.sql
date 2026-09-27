-- El estado de publicación y la actividad de captación son independientes.
ALTER TABLE public.race_uci_stages ADD COLUMN "updatingUntil" timestamptz;

CREATE FUNCTION private.result_capture_window(s public.race_uci_stages)
RETURNS TABLE("opensAt" timestamptz,"closesAt" timestamptz)
LANGUAGE sql STABLE SET search_path='' AS $$
  SELECT
    CASE
      WHEN d."resultsSyncStartAt" IS NOT NULL THEN d."resultsSyncStartAt"
      WHEN d."resultsSyncStartOffsetMinutes" IS NOT NULL
        THEN d."estimatedFinishTimeUtc" + d."resultsSyncStartOffsetMinutes" * interval '1 minute'
      WHEN l."syncStartTime" IS NOT NULL
        THEN ((d."estimatedFinishTimeUtc" AT TIME ZONE 'Europe/Madrid')::date + l."syncStartTime") AT TIME ZONE 'Europe/Madrid'
      ELSE d."estimatedFinishTimeUtc" + l."syncStartOffsetMinutes" * interval '1 minute'
    END,
    CASE
      WHEN d."resultsSyncStopAt" IS NOT NULL THEN d."resultsSyncStopAt"
      WHEN d."resultsSyncStopOffsetMinutes" IS NOT NULL
        THEN d."estimatedFinishTimeUtc" + d."resultsSyncStopOffsetMinutes" * interval '1 minute'
      WHEN l."syncStopTime" IS NOT NULL
        THEN (((d."estimatedFinishTimeUtc" AT TIME ZONE 'Europe/Madrid')::date + l."syncStopTime")
          + CASE WHEN l."syncStartTime" IS NOT NULL AND l."syncStopTime" <= l."syncStartTime"
              THEN interval '1 day' ELSE interval '0 days' END) AT TIME ZONE 'Europe/Madrid'
      ELSE d."estimatedFinishTimeUtc" + l."syncStopOffsetMinutes" * interval '1 minute'
    END
  FROM public.race_days d JOIN public.race_uci_links l ON l."raceId"=d."raceId"
  WHERE d."raceId"=s."raceId" AND NOT COALESCE(d."isCancelledDay",false) AND NOT COALESCE(d."isRestDay",false)
    AND CASE WHEN s."raceDayId" IS NOT NULL THEN d.id=s."raceDayId"
      WHEN s."isFinalClassification" THEN true
      ELSE d."stageNumber" IS NOT DISTINCT FROM s."stageNumber"
        AND (s."stageDate" IS NULL OR d."dateKey"=s."stageDate"::text) END
  ORDER BY d."dateKey" DESC,d."neutralStartTimeUtc" DESC NULLS LAST
  LIMIT 1;
$$;
REVOKE ALL ON FUNCTION private.result_capture_window(public.race_uci_stages) FROM PUBLIC;

CREATE FUNCTION private.bound_result_updating() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE opens_at timestamptz; closes_at timestamptz;
BEGIN
  IF NEW.updating THEN
    SELECT "opensAt","closesAt" INTO opens_at,closes_at FROM private.result_capture_window(NEW);
    NEW."updatingUntil" := closes_at;
    NEW.updating := NEW."publicationStatus"='provisional'
      AND COALESCE(now() >= opens_at AND now() < closes_at,false);
  END IF;
  IF NEW."publicationStatus"='official' THEN NEW.updating:=false; END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.bound_result_updating() FROM PUBLIC;
CREATE TRIGGER bound_result_updating BEFORE INSERT OR UPDATE OF updating,"publicationStatus","raceDayId","raceId","stageNumber","stageDate","isFinalClassification"
  ON public.race_uci_stages FOR EACH ROW EXECUTE FUNCTION private.bound_result_updating();

-- Las excepciones editoriales de horario recalculan los avisos activos.
CREATE FUNCTION private.refresh_result_updating_window() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  UPDATE public.race_uci_stages SET updating=true WHERE "raceId"=NEW."raceId" AND updating;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.refresh_result_updating_window() FROM PUBLIC;
CREATE TRIGGER refresh_result_updating_day AFTER UPDATE OF "estimatedFinishTimeUtc","resultsSyncStartAt","resultsSyncStopAt","resultsSyncStartOffsetMinutes","resultsSyncStopOffsetMinutes","isCancelledDay","isRestDay"
  ON public.race_days FOR EACH ROW EXECUTE FUNCTION private.refresh_result_updating_window();
CREATE TRIGGER refresh_result_updating_link AFTER UPDATE OF "syncStartTime","syncStopTime","syncStartOffsetMinutes","syncStopOffsetMinutes"
  ON public.race_uci_links FOR EACH ROW EXECUTE FUNCTION private.refresh_result_updating_window();

-- El timer retira avisos caducados incluso cuando no hay fuentes que descargar.
CREATE FUNCTION public.expire_result_updating() RETURNS integer
LANGUAGE plpgsql SET search_path='' AS $$
DECLARE affected integer;
BEGIN
  UPDATE public.race_uci_stages SET updating=false
    WHERE updating AND ("updatingUntil" IS NULL OR "updatingUntil"<=now());
  GET DIAGNOSTICS affected=ROW_COUNT;
  RETURN affected;
END;
$$;
REVOKE ALL ON FUNCTION public.expire_result_updating() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.expire_result_updating() TO cc_results_worker;

-- Normaliza solo avisos existentes. No cambia resultados ni oficialidad.
UPDATE public.race_uci_stages SET updating=true WHERE updating;
