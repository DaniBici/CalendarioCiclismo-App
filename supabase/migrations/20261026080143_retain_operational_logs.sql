-- Retención de registros operativos que crecen solos, purgados a diario por pg_cron.
-- Observaciones de emisiones: filas de rutina 14 días; auditoría (altas, actualizaciones,
-- marchas atrás y conflictos) 180 días. stableObservation solo necesita minutos y
-- rollbackObservation lee filas applied_update.
-- Importaciones de inscritos: no aplicadas 30 días; aplicadas 180 días salvo la última
-- de cada carrera, que lee vps_startlist_state.
-- Detalle de ejecuciones de pg_cron: 14 días.

comment on table private.broadcast_source_observations is
  'Registro append-only de observaciones, emparejamientos, cambios y snapshots de rollback. Rutina 14 días y auditoría 180 días; purga diaria por pg_cron.';

comment on table private.startlist_imports is
  'Importaciones de inscritos. No aplicadas 30 días; aplicadas 180 días salvo la última de cada carrera; purga diaria por pg_cron.';

delete from private.broadcast_source_observations
where observed_at < now() - interval '14 days'
  and status not in ('applied_insert', 'applied_update', 'rollback',
                     'manual_conflict', 'optimistic_conflict', 'implausible_change');

delete from private.broadcast_source_observations
where observed_at < now() - interval '180 days';

delete from private.startlist_imports i
where (i.status <> 'applied' and i.updated_at < now() - interval '30 days')
   or (i.status = 'applied' and i.updated_at < now() - interval '180 days'
       and exists (select 1 from private.startlist_imports n
                    where n.race_id = i.race_id and n.status = 'applied'
                      and n.updated_at > i.updated_at));

delete from cron.job_run_details
where start_time < now() - interval '14 days';

select cron.schedule(
  'purge-broadcast-source-observations',
  '20 4 * * *',
  $job$
  delete from private.broadcast_source_observations
  where observed_at < now() - interval '14 days'
    and status not in ('applied_insert', 'applied_update', 'rollback',
                       'manual_conflict', 'optimistic_conflict', 'implausible_change');
  delete from private.broadcast_source_observations
  where observed_at < now() - interval '180 days';
  $job$
);

select cron.schedule(
  'purge-startlist-imports',
  '25 4 * * *',
  $job$
  delete from private.startlist_imports i
  where (i.status <> 'applied' and i.updated_at < now() - interval '30 days')
     or (i.status = 'applied' and i.updated_at < now() - interval '180 days'
         and exists (select 1 from private.startlist_imports n
                      where n.race_id = i.race_id and n.status = 'applied'
                        and n.updated_at > i.updated_at));
  $job$
);

select cron.schedule(
  'purge-cron-job-run-details',
  '30 4 * * *',
  $job$delete from cron.job_run_details where start_time < now() - interval '14 days'$job$
);
