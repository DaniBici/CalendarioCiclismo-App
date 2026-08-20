-- 113_drop_teams_slug.sql
--
-- Retirada de las fichas públicas de equipo (/equipo/<slug>/) y de corredor.
--
-- La columna `teams.slug` existía ÚNICAMENTE para construir la URL pública de la
-- página de equipo (`/equipo/<slug>/` + EN `/en/team/<slug>/`). Esas páginas se
-- han retirado por completo (web + apps): nada en el código vivo lee ni escribe
-- `teams.slug` (verificado: ni los scripts de ingesta UCI, ni el panel, ni el
-- render de inscritos/resultados/orden de salida). El slug NO interviene en el
-- pipeline de poblado (resolve_uci_startlist / resolve_riders /
-- resolve_uci_results se apoyan en id, identityKey, currentTeamId y
-- fold_team_name — NINGUNO toca slug).
--
-- Se elimina por tanto la columna, su índice único parcial (`uq_teams_slug`), el
-- trigger que la autogeneraba (`set_team_slug` → `trg_set_team_slug`) y la función
-- auxiliar `team_base_slug` (sin más usos: solo la invocaba ese trigger).
--
-- Lo que NO se toca (catálogo y poblado siguen intactos):
--   · teams.{id,name,category,countryCode,headerBg,headerText,badge*,gender,
--     specialEdition*} — chapa/nombre/categoría de inscritos y resultados, y
--     validación de maillots especiales en el panel.
--   · team_seasons, rider_team_affiliations — modelo temporal de equipos y
--     plantilla por año (los escribe la ingesta UCI; base de resultados futuros).
--   · Triggers set_team_folded_names y sync_team_to_season_trg.
--
-- Reversible: re-crear con la 080 (teams.slug + team_base_slug + trigger).

BEGIN;

DROP TRIGGER IF EXISTS set_team_slug ON public.teams;
DROP FUNCTION IF EXISTS public.trg_set_team_slug();
DROP FUNCTION IF EXISTS public.team_base_slug(text);
DROP INDEX IF EXISTS public.uq_teams_slug;
ALTER TABLE public.teams DROP COLUMN IF EXISTS slug;

COMMIT;
