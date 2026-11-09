-- Retirada del circuito que pedía builds a GitHub Pages (2026-11-06). Desde el 2026-11-05 la web se sirve
-- desde el VPS y su publicador crea y repinta las páginas; Pages queda de reserva y se construye a mano.
-- Las dos trigger_*uci_results* apuntaban a uci-results-today.yml, que ya no existe, y nada las llamaba.
select cron.unschedule(jobid) from cron.job where jobname = 'web-pages-regen-tick';
drop function public.web_pages_regen_tick();
drop function public.admin_trigger_web_pages_workflow();
drop function public.admin_mark_web_pages_dirty();
drop function private.dispatch_web_pages_workflow();
drop function public._dispatch_web_pages_workflows();
drop function public.trigger_workflows_for_start_order();
drop function public.trigger_uci_results_today_workflow();
drop function public.trigger_configured_uci_results_workflow();
drop table public.web_pages_regen_state;
delete from vault.secrets where name in ('github_dispatch_token', 'internal_trigger_token');
