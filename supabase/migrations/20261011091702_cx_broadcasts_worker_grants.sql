-- Sincronizador de emisiones de ciclocross en el VPS (rol cc_broadcasts_worker).
-- Lectura del calendario CX y escritura acotada de cx_broadcasts: alta de filas,
-- actualización de enlace, hora y orden, solo en los canales que gestiona la
-- automatización (HBO Max/TNT y Sporza). Sin DELETE ni cambios de otras columnas.
-- La auditoría se limita a la operación sync_broadcasts.

GRANT SELECT ON public.cx_races, public.cx_race_categories, public.cx_tournaments
  TO cc_broadcasts_worker;
GRANT SELECT, INSERT ON public.cx_broadcasts TO cc_broadcasts_worker;
GRANT UPDATE (url, "startTimeUtc", "sortOrder") ON public.cx_broadcasts TO cc_broadcasts_worker;
GRANT INSERT ON private.cx_change_log TO cc_broadcasts_worker;

CREATE POLICY cx_broadcasts_worker_read ON public.cx_races
  FOR SELECT TO cc_broadcasts_worker USING (true);
CREATE POLICY cx_broadcasts_worker_read ON public.cx_race_categories
  FOR SELECT TO cc_broadcasts_worker USING (true);
CREATE POLICY cx_broadcasts_worker_read ON public.cx_tournaments
  FOR SELECT TO cc_broadcasts_worker USING (true);
CREATE POLICY cx_broadcasts_worker_read ON public.cx_broadcasts
  FOR SELECT TO cc_broadcasts_worker USING (true);

CREATE POLICY cx_broadcasts_worker_insert ON public.cx_broadcasts
  FOR INSERT TO cc_broadcasts_worker
  WITH CHECK (channel IN ('Eurosport (HBO Max)', 'TNT Sports (HBO Max)', 'Sporza'));
CREATE POLICY cx_broadcasts_worker_update ON public.cx_broadcasts
  FOR UPDATE TO cc_broadcasts_worker
  USING (channel IN ('Eurosport (HBO Max)', 'TNT Sports (HBO Max)', 'Sporza'))
  WITH CHECK (channel IN ('Eurosport (HBO Max)', 'TNT Sports (HBO Max)', 'Sporza'));

CREATE POLICY cx_broadcasts_worker_log ON private.cx_change_log
  FOR INSERT TO cc_broadcasts_worker
  WITH CHECK (operation = 'sync_broadcasts');
