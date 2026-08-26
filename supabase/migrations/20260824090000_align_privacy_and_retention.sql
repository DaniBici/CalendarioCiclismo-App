-- Privacy alignment applied to Supabase on 2026-08-24.
-- The Android beta is closed and its legacy signup data has no remaining product purpose.
drop table if exists public.beta_android_signups;

-- Reports are written by the report-jornada Edge Function using service_role.
revoke all privileges on table public.reports from anon;
revoke all privileges on table public.reports from authenticated;
grant select on table public.reports to authenticated;

comment on table public.reports is
  'User-submitted race-day correction reports. Retained for a maximum of 12 months and cleaned daily by pg_cron.';

delete from public.reports
where created_at < now() - interval '12 months';

select cron.schedule(
  'cleanup-old-privacy-reports',
  '15 4 * * *',
  $job$delete from public.reports where created_at < now() - interval '12 months'$job$
);
