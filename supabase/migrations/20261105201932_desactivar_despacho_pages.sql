-- Corte de la web al VPS (2026-11-05): GitHub Pages queda de reserva y solo se regenera bajo demanda.
-- El publicador del VPS repinta las páginas por su cuenta; el trabajo que despachaba build-site.yml se desactiva.
-- Vuelta atrás: el mismo cron.alter_job con active := true.
select cron.alter_job(job_id := (select jobid from cron.job where jobname = 'web-pages-regen-tick'), active := false);
