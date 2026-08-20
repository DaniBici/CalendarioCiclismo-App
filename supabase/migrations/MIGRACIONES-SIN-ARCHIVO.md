# Migraciones aplicadas en prod sin archivo en el repo — informe de barrido

Barrido del 2026-07-03 (cruce `list_migrations` de la BD ↔ `supabase/migrations/`
del repo por nombre lógico). El flujo del equipo aplica migraciones vía MCP y a
veces el `.sql` no se committea a la vez → el repo queda desincronizado con prod.

## ✅ Reconstruidas en esta pasada (fuentes de resultados — DDL aditivo, verificado idempotente contra prod)

| Archivo | version BD | Qué hace |
|---|---|---|
| `101_race_uci_links_source_matsport.sql` | 20260612130105 | `source` admite `'matsport'` + col `matsportCode` + CHECK |
| `108_race_uci_links_raceresult_source.sql` | 20260617104146 | `source` admite `'raceresult'` + col `raceresultCode` + CHECK |
| `109_race_uci_links_source_sts.sql` | 20260617160436 | `source` admite `'sts'` + col `stsCode` + CHECK |
| `118_race_uci_links_source_domtel.sql` | 20260630185612 | `source` admite `'domtel'` + col `domtelCode` + CHECK (committeada antes en 6a75e779) |

Reconstruidas desde el DDL REAL en prod (columnas, CHECKs y comentarios recuperados
de `pg_constraint`/`col_description`); reaplicarlas en una transacción con ROLLBACK
es no-op (0 filas violan los CHECK).

## ⏭️ NO reconstruidas — ya cubiertas por otro archivo del repo (renumeradas/consolidadas)

Estas versiones de la BD son estados INTERMEDIOS que el equipo consolidó en archivos
que SÍ están en el repo con distinto número. Reconstruirlas plantaría duplicados
históricos confusos.

| version BD | nombre | Ya cubierto en el repo por |
|---|---|---|
| 20260521114012 | create_startlist_riders_resolved_view | `061_startlist_riders_resolved_view.sql` |
| 20260521114131 | fix_resolved_view_treat_empty_country_as_null | `061`/`084` (vista ya evolucionada) |
| 20260521143045 | enable_unaccent_extension | `062_enable_unaccent_for_backfill.sql` |
| 20260609200351 | uci_results_today_external_cron_trigger | `086_uci_results_today_cron_trigger.sql` |
| 20260523194218 | add_timezone_to_race_days | columna `timezone` presente; contexto en `047` |
| 20260521113934 | add_source_verified_to_riders_and_index_globalriderid | índice `idx_startlist_riders_global_rider_id` presente; col `sourceVerified` ya no existe |

## ⏭️ NO reconstruidas — objeto que evolucionó después (riesgo de versión histórica errónea)

Funciones/grants/vistas cuya definición ACTUAL en prod NO es la que tenían en su fecha
original → reconstruir su DDL de hoy en un archivo con fecha antigua sería engañoso.
Si se necesita el objeto en el repo, hacerlo como migración NUEVA con su estado actual,
no rellenando el hueco histórico.

- 20260514134314 push_auto_dispatch_time_trial_label
- 20260601153937 security_invoker_resolved_views
- 20260601154212 revoke_internal_secdef_funcs_from_api_roles
- 20260601154307 lock_down_beta_android_signups_grants
- 20260601154423 revoke_internal_secdef_funcs_from_public
- 20260601154802 move_unaccent_to_extensions_schema
- 20260510182905 push_subscriptions_is_debug (+ drop posterior → columna ya no existe)
- 20260623161638 110_race_days_inherit_slug_from_oneday_race (trigger+func; el nº 110 del repo es OTRA migración: `110_uci_links_event_level` — colisión de numeración)

## ⏭️ NO reconstruidas — DATOS puntuales / one-shot / saneos (irreconstruibles 1:1, ya no aportan)

Migraciones de DATOS (UPDATE/INSERT/DELETE puntuales, saneos, backfills), no de
esquema. No son re-ejecutables con sentido y su efecto ya está en los datos de prod.

- 032b_fix_scheduled_push_column_casing, 036_pg_cron_scheduled_push_fix(_v2)
- 049_auto_dispatch_fine_country_groups, 049b_revert_auto_dispatch_to_bucket
- restore_game_schema_simulador, sim_rider_ratings_readonly_view,
  sim_rider_ratings_security_invoker, retire_simulador_drop_game_schema
- rebuild_cn_linea_sub23_masc_2026_startlist_by_community,
  merge_cn_sub23_masc_2026_dup_fichas, sanitize_cn_linea_sub23_masc_2026_rider_fichas_main,
  cn_flag_prefer_rider_nationality
- 114_ingest_startlist_one_shot, 115_sanea_rider_team_affiliations_pre_inversion,
  115b_collapse_simple_dated_affiliation_dups, 115c_drop_national_selection_affiliations,
  115d_null_current_team_for_national_only_riders,
  116_invert_team_truth_affiliations_to_current_team,
  116b_revoke_execute_on_internal_team_sync_funcs
- 117_drop_saneo_0629_teamgap_backup_tables
- add_volta_portugal_feminina_2026_live_text

## ⚠️ Nota sobre numeración

El repo numera por `NNN_` secuencial; la BD por timestamp. Hay **colisiones de número**
(dos `114_*`, dos `115*`, `110_uci_links_event_level` vs `110_race_days_inherit_slug`).
Al crear migraciones nuevas, revisar el mayor `NNN_` existente para no reutilizar.
El pipeline de resultados (fuentes 101/103/104/108/109/118) queda ✅ completo en el repo.
