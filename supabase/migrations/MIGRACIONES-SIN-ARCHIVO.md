# Cotejo de migraciones: repositorio ↔ producción

Cotejo del 2026-09-28 entre `supabase/migrations/` y
`supabase_migrations.schema_migrations` de producción (533 filas; última
20260928142101 `widget_day_category_order`). Sustituye al barrido del
2026-07-03. Procedimiento para migraciones nuevas: `docs/runbooks/migraciones.md`.

## Resumen

| Clase | Filas |
|---|---|
| Misma versión en repositorio y registro | 179 (131 previas + 48 recuperadas) |
| Mismo nombre, versión distinta | 262 |
| Nombre cambiado, versión distinta | 19 (lista abajo) |
| Solo en el registro: datos puntuales | 53 |
| Solo en el registro: saneos y tablas de respaldo | 20 |
| Solo en el repositorio | 0 (trasladadas a `supabase/migrations-archivo/` y `supabase/migraciones-pendientes/`) |

La versión distinta procede de nombrar el archivo con un timestamp propio: el
registro guarda la hora real de `apply_migration`. Las versiones 001–031 del
registro son numéricas y coinciden con sus archivos; 032–135 figuran en el
registro con timestamp. Versiones repetidas heredadas en el repositorio: 038,
040, 041, 042, 087, 20260912190000 y 20260918210000.

## Recuperadas el 2026-09-28

48 migraciones de esquema aplicadas sin archivo. Cada archivo contiene el texto
de `statements` sin cambios y su versión real, con dos líneas de cabecera. Sustituyen a la
decisión del barrido anterior de no reconstruir objetos que evolucionaron
después: el texto recuperado es el aplicado en su fecha, no el estado actual.

- 20260501045502 032b_fix_scheduled_push_column_casing
- 20260504101936 036_pg_cron_scheduled_push_fix
- 20260504102119 036_pg_cron_scheduled_push_fix_v2
- 20260510182905 push_subscriptions_is_debug
- 20260513082520 049_auto_dispatch_fine_country_groups
- 20260513082836 049b_revert_auto_dispatch_to_bucket
- 20260514134314 push_auto_dispatch_time_trial_label
- 20260521114131 fix_resolved_view_treat_empty_country_as_null
- 20260523194218 add_timezone_to_race_days
- 20260525181916 create_game_rider_ratings
- 20260526052531 game_race_roles
- 20260526055440 game_race_sim
- 20260526075521 race_sim_add_wind_escenario_estados
- 20260601153937 security_invoker_resolved_views
- 20260601154212 revoke_internal_secdef_funcs_from_api_roles
- 20260601154307 lock_down_beta_android_signups_grants
- 20260601154423 revoke_internal_secdef_funcs_from_public
- 20260601154802 move_unaccent_to_extensions_schema
- 20260606135546 restore_game_schema_simulador
- 20260606142929 sim_rider_ratings_readonly_view
- 20260606142955 sim_rider_ratings_security_invoker
- 20260607192506 retire_simulador_drop_game_schema
- 20260623161638 110_race_days_inherit_slug_from_oneday_race
- 20260625043119 cn_flag_prefer_rider_nationality
- 20260627152256 rebuild_cn_linea_sub23_masc_2026_startlist_by_community
- 20260629120838 114_ingest_startlist_one_shot
- 20260629124109 116_invert_team_truth_affiliations_to_current_team
- 20260629124936 116b_revoke_execute_on_internal_team_sync_funcs
- 20260724153422 start_results_polling_at_estimated_finish
- 20260724155954 target_tissot_stage_in_results_dispatch
- 20260731141235 allow_admin_route_gpx_upsert
- 20260813061546 reset_results_auto_sync_to_opt_in
- 20260818143301 document_startlist_rider_country_code_iso2
- 20260831062224 document_final_classification_parentage
- 20260907102734 trust_exact_historical_rider_profile
- 20260907102840 historical_trainee_evidence
- 20260907103227 disambiguate_historical_rider_homonyms
- 20260907103410 link_legacy_uci_rider_profiles
- 20260907104204 preserve_current_rider_nationality
- 20260912090122 support_explicit_gender_in_mixed_startlists
- 20260914191426 broadcasts_country_add_sk
- 20260914191816 broadcasts_country_remove_sk
- 20260917071812 cc_cx_race_country_regional_fix
- 20260918143127 vps_startlist_state_teams
- 20260918182207 vps_belgiancycling_startlist_provisional
- 20260918190203 vps_belgiancycling_startlist_overrides
- 20260918190535 vps_belgiancycling_startlist_apply_always
- 20260918191310 retire_vps_belgiancycling_startlist

## Nombre cambiado, versión distinta

| Archivo | Fila del registro |
|---|---|
| `060_riders_source_verified_and_indexes.sql` | 20260521113934 add_source_verified_to_riders_and_index_globalriderid |
| `061_startlist_riders_resolved_view.sql` | 20260521114012 create_startlist_riders_resolved_view |
| `062_enable_unaccent_for_backfill.sql` | 20260521143045 enable_unaccent_extension |
| `086_uci_results_today_cron_trigger.sql` | 20260609200351 uci_results_today_external_cron_trigger |
| `098_drop_saneo_backup_tables.sql` | 20260629115752 113_drop_saneo_backup_tables |
| `20260824090000_align_privacy_and_retention.sql` | 20260824071932 align_privacy_and_retention_20260824 |
| `20260829074827_tour_of_samsun_yosandy_results_backup.sql` | 20260829054850 tour_of_samsun_20260829_yosandy_results_backup |
| `20260829130000_tour_of_bulgaria_repair_backup.sql` | 20260829041515 tour_of_bulgaria_repair_backup_20260829 |
| `20260829193000_results_only_identity_link_backup.sql` | 20260829100040 results_only_identity_link_backup_20260829 |
| `20260830060000_uci_license_profile_contract.sql` | 20260830054508 uci_license_profile_contract_20260830 |
| `20260830061000_validate_uci_license_checks.sql` | 20260830054619 validate_uci_license_checks_20260830 |
| `20260830062000_create_uci_id_drop_backup.sql` | 20260830062823 create_uci_id_drop_backup_20260830 |
| `20260830063000_drop_uci_license_columns.sql` | 20260830063301 drop_uci_license_columns_20260830 |
| `20260830130000_backup_pending_collective_team_rastreo.sql` | 20260830104724 backup_pending_collective_team_rastreo_20260830 |
| `20260830132000_link_pending_collective_team_rastreo.sql` | 20260830105919 link_pending_collective_team_rastreo_20260830 |
| `20260901093000_enable_private_backup_rls.sql` | 20260901072810 enable_private_backup_rls_20260901 |
| `20260905121000_sync_2027_team_names_except_soudal.sql` | 20260905100934 sync_2027_and_special_edition_team_names_except_soudal |
| `20260915115557_admin_rename_rider.sql` | 20260915095740 admin_rename_rider_rpc |
| `20260915143000_bornan_results_source.sql` | 20260915134124 add_bornan_results_source_v2 |

Las 262 filas con el mismo nombre y versión distinta se obtienen cruzando el
nombre sin prefijo numérico.

## Solo en el registro: datos puntuales (53)

Cargas y correcciones de datos sin DDL. Su efecto está en los datos de
producción y no son reejecutables; no se recuperan a archivo.

- 20260521083511 add_female_worldtour_teams
- 20260521084543 riders_netcompany_ineos_2026
- 20260521084631 riders_lidl_trek_2026
- 20260521084718 riders_lotto_intermarche_2026
- 20260521084827 riders_red_bull_bora_hansgrohe_2026
- 20260521084847 riders_movistar_team_2026
- 20260521084917 riders_soudal_quick_step_2026
- 20260521084934 riders_nsn_cycling_team_2026
- 20260521085004 riders_team_jayco_alula_2026
- 20260521085017 riders_ag_insurance_soudal_fem
- 20260521085044 riders_canyon_sram_zondacrypto_fem
- 20260521085050 riders_team_picnic_postnl_2026
- 20260521085110 riders_ef_education_oatly_fem
- 20260521085135 riders_fdj_united_suez_fem
- 20260521085146 riders_team_visma_lease_a_bike_2026
- 20260521085207 riders_fenix_premier_tech_fem
- 20260521085235 riders_uae_team_emirates_xrg_2026
- 20260521085237 riders_human_powered_health_fem
- 20260521085306 riders_lidl_trek_fem
- 20260521085328 riders_alpecin_premier_tech_2026
- 20260521085341 riders_liv_alula_jayco_fem
- 20260521085413 riders_bahrain_victorious_2026
- 20260521085421 riders_uno_x_mobility_2026_fix
- 20260521085434 riders_movistar_team_fem
- 20260521085458 riders_decathlon_cma_cgm_2026
- 20260521085501 riders_team_picnic_postnl_fem
- 20260521085515 riders_xds_astana_team_2026
- 20260521085541 riders_ef_education_easypost_2026
- 20260521085544 riders_sd_worx_protime_fem
- 20260521085608 riders_visma_lease_a_bike_fem
- 20260521085626 riders_groupama_fdj_united_2026
- 20260521085645 riders_uae_team_adq_fem
- 20260521085717 riders_uno_x_mobility_fem
- 20260521085834 copy_colors_to_female_teams
- 20260521090707 update_riders_women_nationality_birthdate_batch1
- 20260521090720 update_riders_women_nationality_birthdate_batch2
- 20260521090735 update_riders_women_nationality_birthdate_batch3
- 20260521090750 update_riders_women_nationality_birthdate_batch4
- 20260521090814 update_riders_women_nationality_birthdate_batch5
- 20260521090830 update_riders_women_nationality_birthdate_batch6
- 20260521090846 update_riders_women_nationality_birthdate_batch7
- 20260521090900 update_riders_women_nationality_birthdate_batch8
- 20260521090919 update_riders_women_nationality_birthdate_batch9
- 20260521090934 update_riders_women_nationality_birthdate_batch10
- 20260521090948 update_riders_women_nationality_birthdate_batch11
- 20260521091006 update_riders_women_nationality_birthdate_batch12
- 20260521091020 update_riders_women_nationality_birthdate_batch13
- 20260521091037 update_riders_women_nationality_birthdate_batch14
- 20260521093040 fill_birthdate_10_worldtour_teams
- 20260521094847 update_missing_birthdates
- 20260627152930 merge_cn_sub23_masc_2026_dup_fichas
- 20260627152944 sanitize_cn_linea_sub23_masc_2026_rider_fichas_main
- 20260630184926 add_volta_portugal_feminina_2026_live_text

## Solo en el registro: saneos y tablas de respaldo (20)

Crean, protegen o eliminan tablas de respaldo de saneos, o aplican el saneo
junto a su respaldo. No se recuperan a archivo.

- 20260629123416 115_sanea_rider_team_affiliations_pre_inversion
- 20260629123756 115b_collapse_simple_dated_affiliation_dups
- 20260629123907 115c_drop_national_selection_affiliations
- 20260629124017 115d_null_current_team_for_national_only_riders
- 20260630142233 117_drop_saneo_0629_teamgap_backup_tables
- 20260722081846 secure_market_backup_tables
- 20260803155106 respaldo_saneo_burgos_2026
- 20260804165714 drop_temporary_polonia_saneo_tables
- 20260804165920 drop_unused_burgos_saneo_backup
- 20260819193553 saneo_0819_avenir_rider_merge_backups
- 20260819193703 saneo_0819_startlist_backup_text_id
- 20260819193756 saneo_0819_backup_service_policies
- 20260821160318 backup_bct_2026_stage1_before_sector_repair
- 20260823170359 backup_gpcro_20260823_identity_repair
- 20260824041217 backup_gran_prix_panama_20260824_identity_repair
- 20260902074206 crear_backup_reparacion_nombres_volta_santa_catarina_20260902
- 20260905181106 backup_vuelta_2026_stage3_kirsch_withdrawal
- 20260906054735 backup_zlm_stage4_maneffic_publication
- 20260907105522 backup_armenia_duplicate_team_20260907
- 20260911131940 repara_nombres_ven_ruta_20260911_backup_table

## Reconstruidas en el barrido del 2026-07-03

`101_race_uci_links_source_matsport.sql` (20260612130105),
`108_race_uci_links_raceresult_source.sql` (20260617104146),
`109_race_uci_links_source_sts.sql` (20260617160436) y
`118_race_uci_links_source_domtel.sql` (20260630185612) se reconstruyeron desde
el DDL de producción.

## Deriva de funciones

Comparación del cuerpo normalizado (`prosrc`) de las 204 funciones de `public` y
`private` con la última definición del repositorio:

- 174 coinciden; 9 están eliminadas en ambos lados.
- 13 difieren solo en comentarios o formato: el SQL aplicado no llevaba los
  comentarios del archivo.
- 7 se reescriben en producción con `pg_get_functiondef` + `replace` +
  `EXECUTE` desde migraciones con archivo: `resolve_riders`,
  `resolve_uci_results_by_name`, `resolve_historical_uci_results_by_name`,
  `record_result_observation`, `cx_ingest_results`,
  `delete_invalid_results_race` y `guard_trainee_affiliation`.
- `match_existing_riders`: el archivo `20260822121500` no coincidía con lo
  aplicado; restituido al texto registrado el 2026-09-28.
- `trigger_uci_results_today_workflow`, `race_day_inherit_slug_from_oneday_race`
  y la retirada de `vps_import_belgiancycling_startlist`: cubiertas por las
  migraciones recuperadas.
- `delete_push_subscription`: aplicada el 2026-09-28 como
  `20260928150126_push_subscriptions_delete_rpc.sql`.

Tablas y vistas: todas las funcionales tienen `CREATE` en el repositorio; 15
tablas de respaldo no.
