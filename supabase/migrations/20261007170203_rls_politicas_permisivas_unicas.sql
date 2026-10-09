-- Advisor de rendimiento: una sola política permisiva por tabla, rol y acción.
-- Las lecturas públicas (TO public) cubren SELECT; las políticas de escritura
-- de administración y de los workers dejan de cubrir SELECT. Visibilidad y
-- permisos de escritura por rol sin cambios.

-- 1. Administración FOR ALL solapada con la lectura pública (USING true).
drop policy daily_featured_admin on public.daily_featured_races;
create policy daily_featured_admin_ins on public.daily_featured_races
  for insert to authenticated with check ((select private.is_admin()));
create policy daily_featured_admin_upd on public.daily_featured_races
  for update to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));
create policy daily_featured_admin_del on public.daily_featured_races
  for delete to authenticated using ((select private.is_admin()));

drop policy race_classifications_admin on public.race_classifications;
create policy race_classifications_admin_ins on public.race_classifications
  for insert to authenticated with check ((select private.is_admin()));
create policy race_classifications_admin_upd on public.race_classifications
  for update to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));
create policy race_classifications_admin_del on public.race_classifications
  for delete to authenticated using ((select private.is_admin()));

drop policy race_featured_admin on public.race_featured_overrides;
create policy race_featured_admin_ins on public.race_featured_overrides
  for insert to authenticated with check ((select private.is_admin()));
create policy race_featured_admin_upd on public.race_featured_overrides
  for update to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));
create policy race_featured_admin_del on public.race_featured_overrides
  for delete to authenticated using ((select private.is_admin()));

-- 2. Políticas del worker de resultados idénticas a otra ya existente.
drop policy cc_results_worker_read on public.races;
drop policy cc_results_worker_read on public.race_days;
drop policy cc_results_worker_read on public.team_seasons;
drop policy day_metrics_worker on public.race_days;

-- 3. Acceso FOR ALL de los workers sobre tablas de lectura pública: solo escritura.
do $$
declare
  t text;
begin
  foreach t in array array['race_uci_links','race_uci_results','race_uci_stages','startlist_riders','startlist_teams'] loop
    execute format('drop policy cc_results_worker_access on public.%I', t);
    execute format('create policy cc_results_worker_ins on public.%I for insert to cc_results_worker with check (true)', t);
    execute format('create policy cc_results_worker_upd on public.%I for update to cc_results_worker using (true) with check (true)', t);
    execute format('create policy cc_results_worker_del on public.%I for delete to cc_results_worker using (true)', t);
  end loop;
end $$;

drop policy uci_catalog_affiliations on public.rider_team_affiliations;
create policy uci_catalog_affiliations_ins on public.rider_team_affiliations
  for insert to cc_uci_catalog_owner with check (true);
create policy uci_catalog_affiliations_upd on public.rider_team_affiliations
  for update to cc_uci_catalog_owner using (true) with check (true);
create policy uci_catalog_affiliations_del on public.rider_team_affiliations
  for delete to cc_uci_catalog_owner using (true);

-- 4. Catálogo con fichas solo históricas: lectura filtrada para anon y el
-- catálogo UCI; authenticated añade el catálogo histórico si es administrador;
-- cc_results_worker conserva su política propia sin filtro.
alter policy public_read_riders_men on public.riders_men to anon, cc_uci_catalog_owner;
drop policy historical_catalog_admin_read_riders_men on public.riders_men;
create policy authenticated_read_riders_men on public.riders_men
  for select to authenticated using ((not "historicalCatalogOnly") or (select private.is_admin()));

alter policy public_read_riders_women on public.riders_women to anon, cc_uci_catalog_owner;
drop policy historical_catalog_admin_read_riders_women on public.riders_women;
create policy authenticated_read_riders_women on public.riders_women
  for select to authenticated using ((not "historicalCatalogOnly") or (select private.is_admin()));

alter policy public_read_teams on public.teams to anon, cc_uci_catalog_owner;
drop policy historical_catalog_admin_read_teams on public.teams;
create policy authenticated_read_teams on public.teams
  for select to authenticated using ((not "historicalCatalogOnly") or (select private.is_admin()));

-- 5. Índices de soporte para claves foráneas sin cubrir.
create index if not exists daily_featured_races_race_id_idx
  on public.daily_featured_races ("raceId");

create index if not exists cx_standings_state_tournament_season_idx
  on public.cx_standings_state ("tournamentId", "seasonKey");

create index if not exists results_manual_queue_cx_race_id_idx
  on private.results_manual_queue (cx_race_id);

create index if not exists uci_catalog_decisions_case_key_idx
  on private.uci_catalog_decisions (case_key);
