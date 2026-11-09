-- Rol de solo lectura para la publicación por página en el VPS (cc_publicador).
--
-- Alcance: lectura de las tablas públicas de contenido que pintan la web y de sus
-- vistas. Sin escritura ni DDL, sin acceso a auth, storage, vault, cron ni private,
-- sin tablas de usuarios, suscripciones push, notificaciones ni informes. Las
-- transacciones son de solo lectura por defecto.
--
-- La barrera son los GRANT: BYPASSRLS solo evita las políticas de estas tablas. Las
-- consultas del publicador aplican los mismos filtros que la clave anónima.
-- El rol nace NOLOGIN; la credencial se aprovisiona fuera de la migración con
-- scripts/db/provision-publicador-role.mjs (verificador SCRAM, sin contraseña en
-- claro en el repositorio ni en la base).

CREATE ROLE cc_publicador
  NOLOGIN
  NOSUPERUSER
  NOCREATEDB
  NOCREATEROLE
  NOREPLICATION
  NOINHERIT
  BYPASSRLS
  CONNECTION LIMIT 5;

ALTER ROLE cc_publicador SET default_transaction_read_only = on;
ALTER ROLE cc_publicador SET statement_timeout = '2min';
ALTER ROLE cc_publicador SET lock_timeout = '5s';
ALTER ROLE cc_publicador SET idle_in_transaction_session_timeout = '1min';

GRANT USAGE ON SCHEMA public TO cc_publicador;

GRANT SELECT ON TABLE
  public.assets,
  public.broadcasts,
  public.challenge_groups,
  public.cx_broadcasts,
  public.cx_race_categories,
  public.cx_race_featured,
  public.cx_races,
  public.cx_results,
  public.cx_standings_state,
  public.cx_startlist_riders,
  public.cx_teams,
  public.cx_tournament_standings,
  public.cx_tournaments,
  public.cx_videos,
  public.race_classifications,
  public.race_days,
  public.race_featured_overrides,
  public.race_series,
  public.race_uci_results,
  public.race_uci_stages,
  public.races,
  public.rider_transfers,
  public.riders_men,
  public.riders_women,
  public.start_order_entries,
  public.startlist_riders,
  public.startlist_teams,
  public.team_seasons,
  public.teams,
  public.today_highlights,
  public.uci_team_rankings,
  public.cx_category_timing,
  public.start_order_entries_resolved,
  public.startlist_riders_resolved
TO cc_publicador;

GRANT EXECUTE ON FUNCTION public.featured_races_for_dates(text[]) TO cc_publicador;
GRANT EXECUTE ON FUNCTION public.startlist_counts() TO cc_publicador;
