-- 106_route_gpx_storage_bucket.sql
--
-- Bucket público de Supabase Storage para los GPX del mapa interactivo del
-- recorrido (página /mapa/<slug>/).
--
-- POR QUÉ Storage y no R2: el proxy nginx de assets.calendariociclismo.app
-- devuelve el header Access-Control-Allow-Origin DUPLICADO (uno del proxy + uno
-- de R2) en TODOS los assets. Las imágenes/PDF se cargan con <img>/<embed> y no
-- validan CORS, así que nunca dio problema; pero el mapa hace fetch() del GPX
-- cross-origin → el navegador rechaza el ACAO duplicado con "Failed to fetch".
-- Supabase Storage devuelve `access-control-allow-origin: *` (un solo header) de
-- fábrica, sin proxy. race_days.routeGpxUrl (migración 105) apunta aquí.
--
-- Aplicado en prod el 2026-06-15 vía apply_migration (route_gpx_storage_bucket);
-- este archivo lo deja reproducible en el repo.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'route-gpx', 'route-gpx', true, 10485760,
  array['application/gpx+xml','application/xml','text/xml','application/octet-stream']
)
on conflict (id) do update
  set public = true,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Lectura pública (anon) de los objetos del bucket.
drop policy if exists "route_gpx_public_read" on storage.objects;
create policy "route_gpx_public_read" on storage.objects
  for select to public
  using (bucket_id = 'route-gpx');

-- Escritura/actualización/borrado solo para usuarios autenticados (panel admin).
drop policy if exists "route_gpx_auth_write" on storage.objects;
create policy "route_gpx_auth_write" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'route-gpx');

drop policy if exists "route_gpx_auth_update" on storage.objects;
create policy "route_gpx_auth_update" on storage.objects
  for update to authenticated
  using (bucket_id = 'route-gpx')
  with check (bucket_id = 'route-gpx');

drop policy if exists "route_gpx_auth_delete" on storage.objects;
create policy "route_gpx_auth_delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'route-gpx');
