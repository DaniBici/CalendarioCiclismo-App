-- Las páginas públicas de jornada ya creadas se hidratan con datos vivos de Supabase.
-- Los cambios de orden de salida no deben reconstruir el artifact completo.
-- La creación inicial de una URL estática queda a cargo del panel o del flujo
-- operativo, que solo marca la cola cuando la URL canónica todavía responde 404.

drop trigger if exists trigger_workflows_on_race_days_so
  on public.race_days;

drop trigger if exists trigger_workflows_on_start_order_entries
  on public.start_order_entries;
