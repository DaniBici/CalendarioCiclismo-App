-- Publicación del Tour de Francia 2027 aplazada: la presentación del 22-10-2026
-- se retrasa. Se retira el trabajo pg_cron tdf2027-embargo de 20261021112336
-- para que no copie a las 10:00 UTC las jornadas, assets y cintillo de ambos
-- Tours. Las tablas private.tdf2027_embargo_* y private.publish_tdf2027_embargo()
-- se conservan para la publicación manual de cada Tour.

SELECT cron.unschedule('tdf2027-embargo');
