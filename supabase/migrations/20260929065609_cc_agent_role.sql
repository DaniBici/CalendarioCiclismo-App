-- Rol de base de datos acotado para agentes de programación (cc_agent).
--
-- Alcance: lectura y escritura de datos de contenido (carreras, jornadas,
-- assets, emisiones, inscritos, resultados, corredores, equipos, fichajes y
-- ciclocross), las RPC de edición que usan el panel y las skills cc-*, lectura
-- de las colas y registros de automatización, y creación de tablas de respaldo
-- en private. Sin DDL sobre objetos existentes, sin acceso a auth, storage,
-- vault ni cron, sin tablas de usuarios, suscripciones push, notificaciones,
-- informes con correo ni configuración de pg_cron.
--
-- La barrera son los GRANT: BYPASSRLS solo evita las políticas de las tablas
-- concedidas, que están escritas para authenticated + private.is_admin().
-- net.http_* conserva el EXECUTE que Supabase concede a PUBLIC; revocarlo
-- afectaría a todos los roles y queda fuera de esta migración.
-- El rol nace NOLOGIN; la credencial se aprovisiona fuera de la migración con
-- scripts/db/provision-agent-role.mjs (verificador SCRAM, sin contraseña en
-- claro en el repositorio ni en la base).

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'cc_agent') THEN
    CREATE ROLE cc_agent
      NOLOGIN
      NOSUPERUSER
      NOCREATEDB
      NOCREATEROLE
      NOREPLICATION
      NOINHERIT
      BYPASSRLS
      CONNECTION LIMIT 10;
  END IF;
END
$$;

-- postgres puede leer y retirar los respaldos que cree el rol y ejecutar
-- consultas con sus permisos mediante SET LOCAL ROLE cc_agent.
GRANT cc_agent TO postgres WITH INHERIT TRUE, SET TRUE;

ALTER ROLE cc_agent SET statement_timeout = '5min';
ALTER ROLE cc_agent SET lock_timeout = '15s';
ALTER ROLE cc_agent SET idle_in_transaction_session_timeout = '2min';

GRANT CONNECT ON DATABASE postgres TO cc_agent;
GRANT USAGE ON SCHEMA public TO cc_agent;
-- CREATE en private: tablas private.<descripción>_<fecha>_backup de la
-- convención de reparación. Todas las funciones de public y private fijan
-- search_path, por lo que un objeto creado por el rol no altera su resolución.
GRANT USAGE, CREATE ON SCHEMA private TO cc_agent;

-- Contenido: lectura y escritura.
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  public.assets,
  public.broadcasts,
  public.challenge_groups,
  public.cx_broadcasts,
  public.cx_race_categories,
  public.cx_race_uci_links,
  public.cx_races,
  public.cx_results,
  public.cx_riders_men,
  public.cx_riders_women,
  public.cx_startlist_riders,
  public.cx_teams,
  public.cx_tournament_standings,
  public.cx_tournaments,
  public.cx_videos,
  public.daily_featured_races,
  public.race_classifications,
  public.race_days,
  public.race_featured_overrides,
  public.race_series,
  public.race_uci_links,
  public.race_uci_results,
  public.race_uci_stages,
  public.races,
  public.rider_identity_aliases,
  public.rider_team_affiliations,
  public.rider_transfers,
  public.riders_men,
  public.riders_women,
  public.start_order_entries,
  public.startlist_riders,
  public.startlist_teams,
  public.team_development_links,
  public.team_link_decisions,
  public.team_name_aliases,
  public.team_season_variants,
  public.team_seasons,
  public.team_selection_aliases,
  public.teams,
  public.today_highlights,
  public.uci_team_rankings
TO cc_agent;

GRANT SELECT ON TABLE
  public.cx_standings_state,
  public.cx_category_timing,
  public.start_order_entries_resolved,
  public.startlist_riders_resolved
TO cc_agent;

-- admin_mark_web_pages_dirty() es SECURITY INVOKER.
GRANT SELECT, UPDATE ON TABLE public.web_pages_regen_state TO cc_agent;

GRANT USAGE, SELECT ON SEQUENCE
  public.cx_results_id_seq,
  public.race_uci_results_id_seq
TO cc_agent;

-- Estado de publicación y registros que escriben las RPC SECURITY INVOKER.
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE private.result_publication_state TO cc_agent;
GRANT SELECT, INSERT, UPDATE ON TABLE private.result_provider_calibration TO cc_agent;
GRANT SELECT, INSERT ON TABLE private.cx_change_log, private.cx_startlist_imports TO cc_agent;

-- Diagnóstico de automatizaciones e importaciones: solo lectura.
GRANT SELECT ON TABLE
  private.automation_runs,
  private.automation_source_runs,
  private.broadcast_source_links,
  private.broadcast_source_observations,
  private.broadcasts_manual_queue,
  private.cx_push_auto_dispatch,
  private.cx_results_fetch_state,
  private.cx_standings_queue,
  private.historical_identity_batches,
  private.historical_identity_changes,
  private.historical_participation_decisions,
  private.historical_team_roster_observations,
  private.results_manual_queue,
  private.rider_uci_profile_aliases,
  private.startlist_imports,
  private.trainee_import_batches,
  private.uci_catalog_baselines,
  private.uci_catalog_cases,
  private.uci_catalog_changes,
  private.uci_catalog_control,
  private.uci_catalog_decisions,
  private.uci_catalog_rider_exclusions,
  private.uci_catalog_runs,
  private.uci_catalog_team_links
TO cc_agent;

-- RPC de edición, resolución e importación. Excluidas: push, suscripciones,
-- despachadores internos de pg_cron, comprobación de peticiones de PostgREST y
-- funciones exclusivas de los workers del VPS.
GRANT EXECUTE ON FUNCTION
  public.admin_delete_team_season(text,integer),
  public.admin_edit_regular_team_affiliation(text,text,integer,text,text,text,date,date,boolean),
  public.admin_get_automation_monitor(),
  public.admin_get_team_roster(text,integer),
  public.admin_mark_web_pages_dirty(),
  public.admin_rename_rider(text,text,text),
  public.admin_save_day_status(text,text),
  public.admin_save_day_timing(text,jsonb),
  public.admin_save_team_season(text,integer,jsonb),
  public.admin_trigger_broadcasts_sync(),
  public.admin_trigger_results_sync(),
  public.admin_trigger_results_sync(text),
  public.admin_trigger_results_sync(text,integer),
  public.admin_trigger_web_pages_workflow(),
  public.apply_startlist_import(uuid,jsonb),
  public.compute_identity_key(text,text),
  public.cx_apply_startlist_import(uuid),
  public.cx_delete_rider(text,text),
  public.cx_duration_minutes(text,text,text),
  public.cx_enqueue_results_fetch(text,text),
  public.cx_get_startlist_import(uuid),
  public.cx_import_calendar(jsonb),
  public.cx_ingest_results(text,text,jsonb,text,jsonb),
  public.cx_next_race_date(text,date),
  public.cx_next_race_date(text,date,text[]),
  public.cx_prepare_startlist_import(text,text,jsonb),
  public.cx_publish_standings(text,text,text,jsonb,boolean,text,jsonb),
  public.cx_rename_rider(text,text,text),
  public.cx_replace_results(text,text,jsonb,text,jsonb),
  public.cx_require_admin(),
  public.cx_rider_name_matches(text,text,text,text,text),
  public.cx_save_media(text,text,jsonb),
  public.cx_save_race(jsonb,jsonb,boolean),
  public.cx_save_tournament(jsonb),
  public.cx_standings_snapshot(text,text),
  public.cx_temporal_state(timestamp with time zone,integer,timestamp with time zone,boolean),
  public.ensure_startlist_team(text,text,text),
  public.featured_races_for_dates(text[]),
  public.fold_name(text),
  public.fold_name_rpc(text),
  public.fold_team_name(text),
  public.get_startlist_import(uuid),
  public.invalidate_missing_result_observations(text,text,jsonb,bigint[]),
  public.invalidate_result_observations(text,text,integer),
  public.is_startlist_no_team_placeholder(text),
  public.match_existing_riders(text,jsonb),
  public.normalize_cjk_rider_name(text,text),
  public.prepare_startlist_import(text,jsonb,boolean),
  public.recompute_current_team(text,text),
  public.record_result_observation(text,jsonb),
  public.refresh_race_day_metrics(text),
  public.remove_cjk_name_annotations(text),
  public.resolve_historical_result_participations(text,text),
  public.resolve_historical_uci_results_by_name(text,text,jsonb),
  public.resolve_riders(text,jsonb),
  public.resolve_uci_results(text),
  public.resolve_uci_results_by_name(text,text,jsonb),
  public.resolve_uci_startlist(text,text,jsonb),
  public.result_time_seconds(text),
  public.startlist_counts(),
  public.startlist_team_roster(text,text),
  public.sync_startlist_riders_to_canonical(text),
  public.upsert_rider_trainee(text,text,text,integer,date,date,text,integer,text,timestamp with time zone),
  public.widget_day(date,integer,text,text[],text,text[],text[],text[],text[],text),
  public.widget_road_matches(text,text,text,text,text)
TO cc_agent;

GRANT EXECUTE ON FUNCTION
  private.calibrate_result_window(text,timestamp with time zone,numeric,numeric),
  private.cx_dispatch_results_fetch(text,text),
  private.cx_ensure_team(text,text,text,text,text),
  private.cx_publish_standings(text,text,text,jsonb,boolean,text,jsonb),
  private.cx_results_payload_digest(jsonb),
  private.cx_team_for_rider(text,boolean,text,text),
  private.dispatch_broadcasts_sync(),
  private.dispatch_results_sync(text,integer,boolean),
  private.dispatch_web_pages_workflow(),
  private.get_automation_monitor(),
  private.is_admin(),
  private.result_can_auto_finalize(text),
  private.result_fingerprint(text),
  private.result_source_is_live(text),
  private.uci_catalog_review_case(text,text,text),
  private.uci_catalog_review_team(uuid,text,text),
  private.uci_catalog_rollback(uuid)
TO cc_agent;

-- Las comprobaciones de administración de las RPC pasan por is_admin().
-- cc_agent cuenta como administración por conexión propia (session_user) o
-- por SET ROLE, que solo pueden usar los miembros del rol.
CREATE OR REPLACE FUNCTION private.is_admin()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select exists (
    select 1
    from private.admin_users
    where user_id = (select auth.uid())
  )
  or session_user = 'cc_agent'
  or coalesce(current_setting('role', true), '') = 'cc_agent';
$function$;

COMMENT ON ROLE cc_agent IS
  'Agentes de programación: datos de contenido y RPC de edición. Credencial en DATABASE_URL del .env local; aprovisionar con scripts/db/provision-agent-role.mjs.';
