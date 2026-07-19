-- 098: Eliminar las tablas de RESPALDO del saneo (fases dedup + saneo 0610/0611).
--
-- Son snapshots de rollback de los saneos de corredores/equipos/startlists ya
-- completados y verificados. Quedaban en `public`:
--   · 18 con RLS DESACTIVADO → advisor de SEGURIDAD CRITICAL (0013): legibles por
--     el anon key vía PostgREST.
--   · 31 sin PRIMARY KEY → ruido en el advisor de rendimiento (0004).
-- Verificado antes de borrar: 0 FKs entrantes desde tablas reales, 0 vistas que
-- dependan de ellas. Borrado autorizado por Dani (2026-06-11).

drop table if exists public.rider_team_affiliations_bak_cross_2026;
drop table if exists public.riders_birth_bak_uci_shift_0610;
drop table if exists public.riders_intrateam_bak;
drop table if exists public.riders_men_bak_dup_grpa;
drop table if exists public.riders_men_bak_phase2;
drop table if exists public.riders_men_bak_phase2_dedup;
drop table if exists public.riders_men_bak_uci_dup_merge_0610;
drop table if exists public.riders_twins_bak_phase24;
drop table if exists public.riders_women_bak_dup_grpa;
drop table if exists public.riders_women_bak_phase2;
drop table if exists public.riders_women_bak_uci_dup_merge_0610;
drop table if exists public.rta_bak_dup_grpa;
drop table if exists public.rta_bak_phase2;
drop table if exists public.rta_bak_phase2_dedup;
drop table if exists public.saneo_0611_deleted_rows;
drop table if exists public.saneo_0611_deleted_stages;
drop table if exists public.saneo_0611_ineos_fp_st_riders_bak;
drop table if exists public.saneo_0611_ineos_fp_st_teams_bak;
drop table if exists public.saneo_0611_rider_merges;
drop table if exists public.saneo_0611_rider_renames;
drop table if exists public.saneo_0611_startlist_bak;
drop table if exists public.saneo_0611_team_links;
drop table if exists public.saneo_0611_teamgap_affils_bak;
drop table if exists public.saneo_0611_teamgap_riders_bak;
drop table if exists public.saneo_0611_teamgap_st_riders_bak;
drop table if exists public.saneo_0611_teamgap_st_teams_bak;
drop table if exists public.saneo_0611_wtdevo_plan;
drop table if exists public.saneo_0611_wtdevo_st_riders_bak;
drop table if exists public.saneo_0611_wtdevo_st_teams_bak;
drop table if exists public.startlist_riders_bak_dup_grpa;
drop table if exists public.startlist_riders_bak_phase2;
drop table if exists public.startlist_riders_bak_phase2_dedup;
drop table if exists public.startlist_teams_bak_effix;
drop table if exists public.startlist_teams_bak_natdedup;
drop table if exists public.teams_bak_natdedup;
