# Migraciones archivadas

Archivos retirados de `supabase/migrations/` el 2026-09-28 porque su versión no
figura en `supabase_migrations.schema_migrations` de producción. Dentro de
`supabase/migrations/`, `supabase db push` los trataría como pendientes y los
aplicaría. Se conservan como referencia histórica; no se ejecutan.

| Archivo | Estado en producción |
|---|---|
| `032_scheduled_push_notifications.sql` | Aplicada sin registro: la tabla existe. |
| `033_teams_is_dev.sql` | Superada: `startlist_teams."isDev"` ya se retiró. |
| `035_startlist_teams_is_confirmed.sql` | Aplicada sin registro: la columna existe. |
| `046_push_auto_dispatch_race_id.sql` | Función redefinida después; no verificable por separado. |
| `050_push_auto_dispatch_stage_id.sql` | Función redefinida después; no verificable por separado. |
| `063_retire_startlist_teams_isdev_phase1.sql` | Superada por la retirada de `isDev` (fase 2). |
| `073_temporal_model.sql` | Aplicada sin registro: `team_seasons` y `rider_team_affiliations` existen. |
| `096_rls_collapse_permissive_initplan.sql` | Políticas redefinidas después; no verificable por separado. |
| `097_drop_duplicate_rider_indexes.sql` | Aplicada sin registro: los índices ya no existen. |
| `103_sportstiming_results_source.sql` | Aplicada sin registro: `sportstiming` figura en el CHECK. |
| `110_uci_links_event_level.sql` | Aplicada sin registro: el índice `uq_race_uci_links_comp_event` existe. |
| `20260829153000_rider_uci_ids.sql` | Superada: `uciId` no existe; las fichas usan `uciProfileId` y `uciLicenseId`. |
| `20260906071254_initial_startlist_first_stage_only.sql` | Función redefinida después; no verificable por separado. |

El cotejo completo está en `supabase/migrations/MIGRACIONES-SIN-ARCHIVO.md`.
