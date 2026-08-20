-- La instalación inicial de race_series ya declara estos GRANT; este ajuste
-- endurece la tabla creada antes de que se añadiera el REVOKE explícito.
revoke all on table public.race_series from public, anon, authenticated;
grant select on table public.race_series to anon, authenticated;
grant insert, update, delete on table public.race_series to authenticated;
