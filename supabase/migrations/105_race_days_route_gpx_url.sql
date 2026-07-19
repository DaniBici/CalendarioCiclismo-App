-- 105_race_days_route_gpx_url.sql
--
-- Mapa interactivo del recorrido (Leaflet) — opt-in por jornada.
--
-- Almacena la URL pública del GPX CRUDO de la jornada. NULL = la jornada no
-- tiene mapa interactivo (el botón "Mapa" cae entonces al asset estático de
-- tipo `map`, si lo hubiera).
--
-- NOTA (2026-06-15): el GPX se sirve desde SUPABASE STORAGE (bucket público
-- `route-gpx`, ver migración 106), NO desde el proxy R2 assets.calendariociclismo.app:
-- ese proxy duplica el header Access-Control-Allow-Origin y el navegador rechaza
-- el fetch() cross-origin. Storage devuelve CORS correcto de fábrica.
--
-- El MISMO GPX que el panel usa para generar `elevationProfile` (destilado a
-- {km,alt} en la BD) se sube además crudo a R2; la página /mapa/<slug>/ lo lee
-- para dibujar la línea del recorrido sobre el mapa. Los marcadores (puertos,
-- sprints, sectores) salen de `profileSummits`/`profileWaypoints` proyectados
-- por kilómetro sobre la traza — no del GPX.
--
-- Nombre de objeto en R2: route-{raceDayId}.gpx (estable; reemplazar = mismo
-- nombre, sobrescribe).

ALTER TABLE race_days
  ADD COLUMN IF NOT EXISTS "routeGpxUrl" TEXT;
