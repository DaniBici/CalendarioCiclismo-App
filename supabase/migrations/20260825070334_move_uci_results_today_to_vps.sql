-- El sincronizador automático de resultados pasa de GitHub Actions al VPS.
-- Se retira solo el despertador automático de Actions. La función y el workflow
-- se conservan para una reversión y para disparos manuales.

DO $$
DECLARE
  v_jobid bigint;
BEGIN
  FOR v_jobid IN
    SELECT jobid FROM cron.job WHERE jobname = 'trigger-uci-results-today'
  LOOP
    PERFORM cron.unschedule(v_jobid);
  END LOOP;
END
$$;
