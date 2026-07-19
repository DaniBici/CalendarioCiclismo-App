-- 111: Eliminar las tablas de RESPALDO acumuladas tras la migración 098.
--
-- Misma naturaleza que la 098: snapshots de rollback de saneos/migraciones de
-- corredores, equipos y jornadas ya completados y verificados. Quedaban en
-- `public` como ruido (sin uso por la app, candidatas de los advisors de
-- seguridad/rendimiento por RLS off / sin PRIMARY KEY).
--
-- Verificado antes de borrar (2026-06-27): 0 FKs entrantes y 0 vistas
-- dependientes en las 9 (pg_constraint contype='f' + pg_depend/pg_rewrite).
-- No las consume ningún código de web/iOS/Android (solo eran respaldo de SQL).

drop table if exists public.cn2026_rd_publish_bak;
drop table if exists public.cn2026_rd_slug_backfill_bak;
drop table if exists public.cn_cri_sub23_dedup_bak_20260625;
drop table if exists public.cn_cri_sub23_rename_bak_20260625;
drop table if exists public.saneo_0612_findlay_merge;
drop table if exists public.saneo_0612_malo_merges;
drop table if exists public.saneo_0612_malo_namefix;
drop table if exists public.saneo_0616_rider_merges;
drop table if exists public.saneo_0621_masurian_rider_merges;
