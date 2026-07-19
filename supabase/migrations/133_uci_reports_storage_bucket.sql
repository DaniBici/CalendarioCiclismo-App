-- 133_uci_reports_storage_bucket.sql
--
-- Bucket PRIVADO de Supabase Storage para el match-report del matcher UCI
-- (scripts/results-fetchers/uci-match-poc.mjs). Lo escriben los crons
-- uci-link-discover.yml (05:40) y uci-link-evening.yml (19:00); lo lee el panel
-- en runtime (_loadUciReport en js/panel.js) para ofrecer los candidatos de
-- enlace carrera↔competición UCI.
--
-- POR QUÉ Storage y no git: hasta ahora el report se COMMITEABA a main y el
-- panel lo leía con una ruta relativa (../scripts/...). Pero build-site.yml
-- excluye `scripts/` del rsync a _site → en producción esa ruta daba 404 y la
-- auto-detección de candidatos estaba ROTA (regresión silenciosa de la
-- migración a Pages-por-artifact). De paso, mover el fichero aquí quita de main
-- los dos commits "[auto]" diarios del matcher.
--
-- POR QUÉ PRIVADO (a diferencia de route-gpx, migración 106): el report expone
-- el calendario interno y los candidatos UCI sin casar. No lo lee la web
-- anónima: el único consumidor es el panel, que está autenticado
-- (supabase.auth.getSession()). route-gpx es público porque lo consume la
-- página pública /mapa/<slug>/ sin sesión.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'uci-reports', 'uci-reports', false, 2097152,
  array['application/json']
)
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Lectura solo para usuarios autenticados (el panel admin). NO `to public`:
-- con el bucket privado y sin esta política, el anon no ve nada.
drop policy if exists "uci_reports_auth_read" on storage.objects;
create policy "uci_reports_auth_read" on storage.objects
  for select to authenticated
  using (bucket_id = 'uci-reports');

-- NO se crean políticas de escritura a propósito: quien escribe es el workflow
-- de GitHub Actions con la service_role, que BYPASSA RLS. El panel solo lee.
-- (route-gpx sí tiene políticas de INSERT/UPDATE/DELETE porque allí escribe el
-- panel desde el navegador con la sesión del usuario.)
