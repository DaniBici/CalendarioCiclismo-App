-- 096: Colapsar políticas RLS permisivas duplicadas + envolver auth.uid() (initplan).
--
-- Antes: cada tabla caliente tenía `<x>_write_*` FOR ALL (cubre también SELECT) +
-- `public_read_*` / `*_select_public` FOR SELECT → DOS políticas permisivas
-- evaluadas en cada lectura anónima, y `auth.uid()` re-evaluado POR FILA. Esto
-- disparaba los advisors 0003 (auth_rls_initplan) y 0006 (multiple_permissive_policies)
-- y añadía coste de planificación/ejecución a TODAS las lecturas del frontend.
--
-- Ahora: la escritura se acota a INSERT/UPDATE/DELETE (ya NO toca SELECT) y la
-- condición usa `(select auth.uid())` — se evalúa UNA vez por consulta, no por fila.
-- La lectura pública (SELECT = true) queda como única política permisiva de SELECT.
--
-- Sin cambio de comportamiento: anon sigue leyendo todo; authenticated (panel) sigue
-- escribiendo. El cron/backfill usa service_role (salta RLS) → no afectado.
-- Idempotente: se puede re-ejecutar sin error.

do $$
declare
  t   text;
  pol text;
  tables text[] := array[
    'assets','broadcasts','challenge_groups','push_notifications','race_days','races',
    'rider_team_affiliations','riders_men','riders_women','start_order_entries',
    'startlist_riders','startlist_teams','team_seasons','teams',
    'race_uci_links','race_uci_results','race_uci_stages'
  ];
begin
  foreach t in array tables loop
    -- Eliminar TODA política permisiva FOR ALL (la de escritura) de la tabla.
    for pol in
      select p.polname
      from pg_policy p
      join pg_class c on c.oid = p.polrelid
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = t
        and p.polcmd = '*' and p.polpermissive
    loop
      execute format('drop policy if exists %I on public.%I', pol, t);
    end loop;

    -- Recrear la escritura acotada por comando y envuelta para el planner.
    -- (drop-if-exists previo → idempotencia).
    execute format('drop policy if exists %I on public.%I', t || '_write_ins', t);
    execute format('drop policy if exists %I on public.%I', t || '_write_upd', t);
    execute format('drop policy if exists %I on public.%I', t || '_write_del', t);

    execute format(
      'create policy %I on public.%I for insert to authenticated with check ((select auth.uid()) is not null)',
      t || '_write_ins', t);
    execute format(
      'create policy %I on public.%I for update to authenticated using ((select auth.uid()) is not null) with check ((select auth.uid()) is not null)',
      t || '_write_upd', t);
    execute format(
      'create policy %I on public.%I for delete to authenticated using ((select auth.uid()) is not null)',
      t || '_write_del', t);
  end loop;
end $$;
